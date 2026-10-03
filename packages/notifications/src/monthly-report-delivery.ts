import { previousMonth } from "@sla/core";
import {
  decryptToken,
  EmailSettingsUnreadableError,
  getEmailSettings,
  isUniqueConstraintError,
  type IntegrationProvider,
  type PrismaClient,
} from "@sla/db";
import { sendEmail } from "@sla/email";
import { postMessage } from "@sla/slack";
import { toEmailConfig } from "./dispatch";
import { DEFAULT_EMAIL_BRAND_NAME } from "./format";
import { buildMonthlyReport, hasActivity, type MonthlyReport } from "./monthly-report";
import {
  monthlyReportCsvFilename,
  monthlyReportSubject,
  renderMonthlyReportCsv,
  renderMonthlyReportHtml,
  renderMonthlyReportSlack,
  renderMonthlyReportText,
} from "./monthly-report-render";

/**
 * Delivers one organization's monthly report, exactly once per month and
 * channel (N5.6).
 *
 * The idempotency key is the `ReportDelivery` unique key `(organizationId,
 * period, channel)`. Claiming a month is an insert, so two ticks, or two
 * workers, cannot both send it: the loser hits the unique constraint and does
 * nothing. A report that fails is retried, a bounded number of times and not
 * more often than `retryAfterMs`, and the reason lands in
 * `ReportDelivery.error` where the platform admin sees it. A claim whose
 * worker died is reclaimed after `staleClaimMs`.
 *
 * Month boundaries are the organization's own wall clock
 * (`Organization.timezone`); SLA arithmetic is unaffected by it.
 */

export type ReportChannel = "email" | "slack";
const CHANNELS: ReportChannel[] = ["email", "slack"];

export const REPORT_MAX_ATTEMPTS = 5;
export const REPORT_RETRY_AFTER_MS = 30 * 60_000;
export const REPORT_STALE_CLAIM_MS = 30 * 60_000;
const ERROR_LIMIT = 500;

export type ChannelOutcome =
  /** Delivered by this call. */
  | "sent"
  /** Attempted by this call and failed; `ReportDelivery.error` says why. */
  | "failed"
  /** Nothing to send: channel not configured, or the month had no activity. Final. */
  | "skipped"
  /** Already delivered, skipped or given up on before this call. */
  | "settled"
  /** Another worker holds it, or a retry is not due yet. */
  | "not_claimed";

export interface MonthlyReportDeliveryOptions {
  appUrl: string | null;
  /** Which providers are trackers or code hosts (the caller's adapter registry). */
  issueLinkProviders: IntegrationProvider[];
  now?: Date;
  /** The operator kill switch (`WorkerSettings.monthlyReportEnabled`). Off: nothing is sent and nothing is recorded. */
  enabled?: boolean;
  maxAttempts?: number;
  retryAfterMs?: number;
  staleClaimMs?: number;
  /** Awaited once, after a channel was claimed and before anything is sent: the worker confirms it still owns the organization. */
  beforeSend?: () => Promise<void>;
}

export interface MonthlyReportDeliveryResult {
  /** The month considered (`YYYY-MM`), or null when switched off or the organization is gone. */
  period: string | null;
  /** Whether the report was built (some channel was claimed and the month had a recipient to attempt). */
  built: boolean;
  channels: Partial<Record<ReportChannel, ChannelOutcome>>;
}

interface DeliveryRow {
  id: string;
  channel: string;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  updatedAt: Date;
}

/** Failure text kept for the operator: bounded, and with email addresses removed (an SMTP error often quotes the recipient). */
export function scrubDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[^\s@<>"']+@[^\s@<>"']+/g, "<recipient>").slice(0, ERROR_LIMIT);
}

function isSettled(row: DeliveryRow | undefined, maxAttempts: number): boolean {
  if (!row) return false;
  return row.status === "sent" || row.status === "skipped" || (row.status === "failed" && row.attempts >= maxAttempts);
}

export async function deliverMonthlyReport(
  prisma: PrismaClient,
  organizationId: string,
  options: MonthlyReportDeliveryOptions,
): Promise<MonthlyReportDeliveryResult> {
  if (options.enabled === false) return { period: null, built: false, channels: {} };

  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? REPORT_MAX_ATTEMPTS;
  const retryAfterMs = options.retryAfterMs ?? REPORT_RETRY_AFTER_MS;
  const staleClaimMs = options.staleClaimMs ?? REPORT_STALE_CLAIM_MS;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { createdAt: true, timezone: true },
  });
  if (!organization) return { period: null, built: false, channels: {} };

  const month = previousMonth(now, organization.timezone);
  // An organization created after the month ended has nothing to report for it.
  if (organization.createdAt >= month.end) return { period: month.period, built: false, channels: {} };

  const rows = (await prisma.reportDelivery.findMany({ where: { organizationId, period: month.period } })) as DeliveryRow[];
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  const channels: MonthlyReportDeliveryResult["channels"] = {};
  const due = CHANNELS.filter((channel) => {
    if (isSettled(byChannel.get(channel), maxAttempts)) {
      channels[channel] = "settled";
      return false;
    }
    return true;
  });
  if (due.length === 0) return { period: month.period, built: false, channels };

  // What each due channel can deliver to, read once.
  const [slack, emailSettings] = await Promise.all([
    due.includes("slack") ? prisma.slackIntegration.findUnique({ where: { organizationId } }) : null,
    due.includes("email") ? readEmailSettings(prisma, organizationId) : null,
  ]);
  const slackTarget = slack?.channelId ? { accessToken: slack.accessToken, channelId: slack.channelId } : null;

  const claimed: ReportChannel[] = [];
  for (const channel of due) {
    const target = channel === "slack" ? slackTarget !== null : emailSettings !== null;
    const outcome = await claimChannel(prisma, { organizationId, period: month.period, channel, existing: byChannel.get(channel), now, maxAttempts, retryAfterMs, staleClaimMs, skipReason: target ? null : `${channel === "slack" ? "Slack" : "Email"} is not configured` });
    if (outcome === "claimed") claimed.push(channel);
    else channels[channel] = outcome;
  }
  if (claimed.length === 0) return { period: month.period, built: false, channels };

  const finish = (channel: ReportChannel, outcome: "sent" | "failed" | "skipped", error: string | null) =>
    settleChannel(prisma, { organizationId, period: month.period, channel, outcome, error, now }).then(() => {
      channels[channel] = outcome;
    });

  try {
    await options.beforeSend?.();
    const report = await buildMonthlyReport(prisma, {
      organizationId,
      period: month.period,
      issueLinkProviders: options.issueLinkProviders,
      appUrl: options.appUrl,
      now,
    });
    if (!report) {
      for (const channel of claimed) await finish(channel, "failed", "Organization not found");
      return { period: month.period, built: false, channels };
    }
    if (!hasActivity(report)) {
      for (const channel of claimed) await finish(channel, "skipped", "No activity in the month");
      return { period: month.period, built: true, channels };
    }

    for (const channel of claimed) {
      try {
        if (channel === "slack") {
          await postMessage(decryptToken(slackTarget!.accessToken), slackTarget!.channelId, renderMonthlyReportSlack(report));
          await finish(channel, "sent", null);
        } else {
          if (emailSettings === "unreadable") throw new Error("Saved email settings cannot be read (the encryption key may have changed)");
          const partial = await sendReportEmails(prisma, organizationId, emailSettings!, report);
          await finish(channel, "sent", partial);
        }
      } catch (error) {
        await finish(channel, "failed", scrubDeliveryError(error));
      }
    }
  } catch (error) {
    // Building failed, or the caller no longer owns the organization (`beforeSend` threw).
    // Unsettled claims are released as failures so a later tick can retry them.
    for (const channel of claimed) {
      if (channels[channel] === undefined) await finish(channel, "failed", scrubDeliveryError(error));
    }
    throw error;
  }
  return { period: month.period, built: true, channels };
}

type EmailSettings = NonNullable<Awaited<ReturnType<typeof getEmailSettings>>>;

/** `null` when none are saved; `"unreadable"` when saved but not decryptable (a rotated key), which is a failure to surface, not "not configured". */
async function readEmailSettings(prisma: PrismaClient, organizationId: string): Promise<EmailSettings | "unreadable" | null> {
  try {
    return await getEmailSettings(prisma, organizationId);
  } catch (error) {
    if (error instanceof EmailSettingsUnreadableError) return "unreadable";
    throw error;
  }
}

/** One send per recipient, so a bad address blocks nobody and no recipient sees who else got it. Returns a note when only some went out. */
async function sendReportEmails(
  prisma: PrismaClient,
  organizationId: string,
  settings: EmailSettings,
  report: MonthlyReport,
): Promise<string | null> {
  const config = toEmailConfig(settings);
  const recipients = (await prisma.user.findMany({ where: { organizationId }, select: { email: true } })).map((u) => u.email);
  if (recipients.length === 0) throw new Error("No recipients: the organization has no members");

  const message = {
    subject: monthlyReportSubject(report),
    text: renderMonthlyReportText(report),
    html: renderMonthlyReportHtml(report, config.fromName || DEFAULT_EMAIL_BRAND_NAME),
    attachments: [{ filename: monthlyReportCsvFilename(report), content: renderMonthlyReportCsv(report), contentType: "text/csv; charset=utf-8" }],
  };

  let sent = 0;
  let firstError: unknown = null;
  for (const recipient of recipients) {
    try {
      await sendEmail(config, { to: [recipient], ...message }, { publicDestinationOnly: true });
      sent += 1;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (sent === 0) throw firstError;
  return sent < recipients.length ? `${recipients.length - sent} of ${recipients.length} recipients failed: ${scrubDeliveryError(firstError)}` : null;
}

type ClaimOutcome = "claimed" | "skipped" | "not_claimed";

async function claimChannel(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    period: string;
    channel: ReportChannel;
    existing: DeliveryRow | undefined;
    now: Date;
    maxAttempts: number;
    retryAfterMs: number;
    staleClaimMs: number;
    /** Set when the channel has nowhere to deliver; the month is then recorded as skipped. */
    skipReason: string | null;
  },
): Promise<ClaimOutcome> {
  const { organizationId, period, channel, existing, now } = input;

  if (!existing) {
    try {
      await prisma.reportDelivery.create({
        data: input.skipReason
          ? { organizationId, period, channel, status: "skipped", attempts: 0, error: input.skipReason, createdAt: now, updatedAt: now }
          : { organizationId, period, channel, status: "pending", attempts: 1, createdAt: now, updatedAt: now },
      });
      return input.skipReason ? "skipped" : "claimed";
    } catch (error) {
      if (isUniqueConstraintError(error)) return "not_claimed";
      throw error;
    }
  }

  const ageMs = now.getTime() - existing.updatedAt.getTime();
  if (existing.status === "failed" && existing.attempts < input.maxAttempts && ageMs >= input.retryAfterMs) {
    // Compare-and-set on the attempt count: of several workers, one wins the retry.
    const { count } = await prisma.reportDelivery.updateMany({
      where: { id: existing.id, status: "failed", attempts: existing.attempts },
      data: { status: "pending", attempts: existing.attempts + 1, updatedAt: now },
    });
    return count === 1 ? "claimed" : "not_claimed";
  }
  if (existing.status === "pending" && ageMs >= input.staleClaimMs) {
    // The worker that held it died mid-send.
    const { count } = await prisma.reportDelivery.updateMany({
      where: { id: existing.id, status: "pending", updatedAt: existing.updatedAt },
      data: { attempts: existing.attempts + 1, updatedAt: now },
    });
    return count === 1 ? "claimed" : "not_claimed";
  }
  return "not_claimed";
}

async function settleChannel(
  prisma: PrismaClient,
  input: { organizationId: string; period: string; channel: ReportChannel; outcome: "sent" | "failed" | "skipped"; error: string | null; now: Date },
): Promise<void> {
  await prisma.reportDelivery.updateMany({
    // Only our own claim: never overwrite a row another worker has since moved on.
    where: { organizationId: input.organizationId, period: input.period, channel: input.channel, status: "pending" },
    data: {
      status: input.outcome,
      error: input.error,
      updatedAt: input.now,
      ...(input.outcome === "sent" ? { deliveredAt: input.now } : {}),
    },
  });
}
