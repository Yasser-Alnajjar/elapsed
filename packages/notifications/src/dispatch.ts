import { decryptToken, getEmailSettings, EmailSettingsUnreadableError, type PrismaClient } from "@sla/db";
import { postMessage } from "@sla/slack";
import { sendEmail, type EmailConfig } from "@sla/email";
import type { NotificationCandidate } from "@sla/commitments";
import { formatSlackMessage, formatEmailMessage } from "./format";

function toEmailConfig(settings: NonNullable<Awaited<ReturnType<typeof getEmailSettings>>>): EmailConfig {
  return {
    host: settings.host,
    port: settings.port,
    security: settings.security,
    user: settings.username,
    password: settings.password,
    from: settings.fromEmail,
    fromName: settings.fromName,
  };
}

export interface NotificationPipelineResult {
  notificationsSent: number;
  // Not connected, no channel/recipients configured yet, or already sent for
  // that (commitmentId, threshold) — the common, expected case once a
  // commitment has settled at a given threshold.
  notificationsSkipped: number;
  notificationsFailed: { commitmentId: string; threshold: number; error: string }[];
}

/** `Notification.channel` while a claim is held and sends are in flight — replaced by the delivered channel list once they finish. */
const CLAIMED_CHANNEL = "pending";

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A claim still `pending` after this long belonged to a process that died
 * between claiming and finishing its sends. It's released so the alert is
 * retried on the next cycle rather than lost. Generous on purpose: a live
 * cycle's sends finish in seconds, so this only ever fires for a crash.
 */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

/**
 * Sends Slack and/or email alerts for notification candidates surfaced by
 * `runEvaluationPipeline` (Phase 13.7). Both channels share one dedup slot:
 * the `Notification` table's `@@unique([commitmentId, threshold])`
 * constraint guards "has this alert been dispatched at all", not
 * per-channel.
 *
 * Two phases, split so the slow one runs outside the organization's advisory
 * lock (roadmap 7.7 — Slack/SMTP round trips used to hold it, blocking
 * webhook deliveries for that organization):
 *
 * 1. `claimNotifications` — cheap, DB-only, run *inside* the lock. Decides
 *    which candidates still need sending and `create`s their `Notification`
 *    row (placeholder `channel`) before any Slack/email call. A concurrent
 *    cycle or webhook racing on the same candidate hits `P2002` on the
 *    unique constraint and skips, so no two processes ever send the same
 *    alert, lock or no lock.
 * 2. `deliverClaimedNotifications` — the network calls, run *after* the lock
 *    is released. Sends only what was claimed, then finalizes: rewrites
 *    `channel` to what actually delivered (e.g. `"slack,email"`), or, if
 *    every channel failed, deletes the claim (so a later cycle retries) and
 *    upserts a `NotificationFailure`.
 *
 * A process that dies between the two leaves a `"pending"` claim.
 * `claimNotifications` releases claims older than `STALE_CLAIM_MS` on the
 * next cycle, so that alert is retried instead of lost. (Before this the
 * pipeline was strictly at-most-once; a stale-claim release means a rare
 * crash-mid-send can now page twice rather than never.)
 *
 * `runNotificationPipeline` runs both back to back for callers that don't
 * hold the lock or don't care (webhook tail, tests).
 *
 * Email credentials are loaded per organization from `OrganizationEmailSettings`
 * (the settings UI, roadmap: organization SMTP configuration) rather than a
 * deployment-wide `.env` — there is no fallback to deployment-level SMTP
 * variables, matching `SlackIntegration`'s per-organization, nullable
 * pattern: an organization that hasn't saved SMTP configuration just gets
 * no email channel, an unattended worker must not crash-loop over it. A row
 * that exists but can't be decrypted (`EmailSettingsUnreadableError` — a
 * rotated/missing `SMTP_ENCRYPTION_KEY`, or corrupted ciphertext) is treated
 * the same as "not configured": still no crash, Slack (if ready) still
 * fires.
 */
export interface NotificationPipelineOptions {
  /** Deployment base URL (`NEXTAUTH_URL`) — used only to build a "View ticket" link in the branded HTML email. Omit (or leave unconfigured) and emails send without that link. */
  appUrl?: string | null;
  /** Override for `STALE_CLAIM_MS` (tests). */
  staleClaimMs?: number;
}

interface ClaimedNotification {
  candidate: NotificationCandidate;
  claimId: string;
  context: {
    externalId: string;
    customerName: string | null;
    subject: string | null;
    caseUrl: string | null;
  };
}

/** Everything `deliverClaimedNotifications` needs, resolved while the lock was held so nothing is re-read after it. */
export interface NotificationClaims {
  claimed: ClaimedNotification[];
  skipped: number;
  slack: { accessToken: string; channelId: string } | null;
  emailConfig: EmailConfig | null;
  emailTo: string[];
}

export async function claimNotifications(
  prisma: PrismaClient,
  organizationId: string,
  candidates: NotificationCandidate[],
  options: NotificationPipelineOptions = {},
): Promise<NotificationClaims> {
  const claims: NotificationClaims = { claimed: [], skipped: 0, slack: null, emailConfig: null, emailTo: [] };

  // Release claims a crashed process never finished, before deciding what
  // still needs sending — even with no candidates this cycle, so a stale
  // claim doesn't linger until the commitment next alerts.
  await prisma.notification.deleteMany({
    where: {
      channel: CLAIMED_CHANNEL,
      sentAt: { lt: new Date(Date.now() - (options.staleClaimMs ?? STALE_CLAIM_MS)) },
      commitment: { case: { organizationId } },
    },
  });

  if (candidates.length === 0) return claims;

  const [slack, emailSettings] = await Promise.all([
    prisma.slackIntegration.findUnique({ where: { organizationId } }),
    getEmailSettings(prisma, organizationId).catch((error) => {
      if (error instanceof EmailSettingsUnreadableError) return null;
      throw error;
    }),
  ]);

  const slackReady = Boolean(slack?.channelId);
  const emailConfig = emailSettings ? toEmailConfig(emailSettings) : null;
  const recipients = emailConfig
    ? await prisma.user.findMany({ where: { organizationId }, select: { email: true } })
    : [];
  const emailTo = recipients.map((r) => r.email);
  const emailReady = Boolean(emailConfig) && emailTo.length > 0;

  if (!slackReady && !emailReady) {
    claims.skipped = candidates.length;
    return claims;
  }
  claims.slack = slackReady ? { accessToken: decryptToken(slack!.accessToken), channelId: slack!.channelId! } : null;
  claims.emailConfig = emailReady ? emailConfig : null;
  claims.emailTo = emailReady ? emailTo : [];

  const existing = await prisma.notification.findMany({
    where: { commitmentId: { in: candidates.map((c) => c.commitmentId) } },
    select: { commitmentId: true, threshold: true },
  });
  const alreadySent = new Set(existing.map((e) => `${e.commitmentId}:${e.threshold}`));
  const toSend = candidates.filter((c) => !alreadySent.has(`${c.commitmentId}:${c.threshold}`));
  claims.skipped += candidates.length - toSend.length;
  if (toSend.length === 0) return claims;

  const caseRows = await prisma.case.findMany({
    where: { id: { in: [...new Set(toSend.map((c) => c.caseId))] }, deletedAt: null },
    select: { id: true, externalId: true, subject: true, customer: { select: { name: true } } },
  });
  const caseById = new Map(caseRows.map((c) => [c.id, c]));

  for (const candidate of toSend) {
    const caseRow = caseById.get(candidate.caseId);
    if (!caseRow) continue;

    try {
      const claim = await prisma.notification.create({
        data: { commitmentId: candidate.commitmentId, threshold: candidate.threshold, channel: CLAIMED_CHANNEL },
        select: { id: true },
      });
      claims.claimed.push({
        candidate,
        claimId: claim.id,
        context: {
          externalId: caseRow.externalId,
          customerName: caseRow.customer?.name ?? null,
          subject: caseRow.subject,
          // 3.9/E-19: shared by both channels — Slack alerts previously carried
          // no case link at all.
          caseUrl: options.appUrl ? `${options.appUrl}/cases/${caseRow.id}` : null,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      claims.skipped += 1;
    }
  }

  return claims;
}

export async function runNotificationPipeline(
  prisma: PrismaClient,
  organizationId: string,
  candidates: NotificationCandidate[],
  options: NotificationPipelineOptions = {},
): Promise<NotificationPipelineResult> {
  return deliverClaimedNotifications(prisma, await claimNotifications(prisma, organizationId, candidates, options));
}

export async function deliverClaimedNotifications(
  prisma: PrismaClient,
  claims: NotificationClaims,
): Promise<NotificationPipelineResult> {
  const result: NotificationPipelineResult = {
    notificationsSent: 0,
    notificationsSkipped: claims.skipped,
    notificationsFailed: [],
  };
  const { slack, emailConfig, emailTo } = claims;

  for (const { candidate, claimId, context } of claims.claimed) {
    const claim = { id: claimId };
    const delivered: string[] = [];
    const errors: string[] = [];

    if (slack) {
      try {
        await postMessage(slack.accessToken, slack.channelId, formatSlackMessage(candidate, context));
        delivered.push("slack");
      } catch (error) {
        errors.push(`slack: ${errorMessage(error)}`);
      }
    }

    if (emailConfig) {
      const brand = { name: emailConfig.fromName };
      const { subject, text, html } = formatEmailMessage(candidate, context, brand);
      // 3.10: one send per recipient, not everyone listed in one `To` — a
      // bad address for one recipient doesn't block the others, and no
      // recipient can see who else was alerted.
      const recipientErrors: string[] = [];
      let anyEmailSent = false;
      for (const recipient of emailTo) {
        try {
          await sendEmail(emailConfig, { to: [recipient], subject, text, html }, { publicDestinationOnly: true });
          anyEmailSent = true;
        } catch (error) {
          recipientErrors.push(`${recipient}: ${errorMessage(error)}`);
        }
      }
      if (anyEmailSent) delivered.push("email");
      if (recipientErrors.length > 0) errors.push(`email: ${recipientErrors.join("; ")}`);
    }

    if (delivered.length === 0) {
      const errorMessageJoined = errors.join("; ");
      // Release the claim so a later cycle retries this alert, but keep a
      // durable record of the failure (Phase 6.4) — the claim row itself
      // can't serve that purpose, since it's deleted precisely so the retry
      // can happen.
      await prisma.$transaction([
        prisma.notification.delete({ where: { id: claim.id } }),
        prisma.notificationFailure.upsert({
          where: {
            commitmentId_threshold: { commitmentId: candidate.commitmentId, threshold: candidate.threshold },
          },
          create: { commitmentId: candidate.commitmentId, threshold: candidate.threshold, error: errorMessageJoined },
          update: { error: errorMessageJoined, attempts: { increment: 1 }, lastFailedAt: new Date() },
        }),
      ]);
      result.notificationsFailed.push({ commitmentId: candidate.commitmentId, threshold: candidate.threshold, error: errorMessageJoined });
      continue;
    }

    // A previously-failing candidate that just succeeded: clear its failure
    // record so the dashboard's failed-deliveries panel doesn't keep
    // reporting an alert that went out. Best-effort — the row may not exist.
    await prisma.$transaction([
      prisma.notification.update({ where: { id: claim.id }, data: { channel: delivered.join(",") } }),
      prisma.notificationFailure.deleteMany({
        where: { commitmentId: candidate.commitmentId, threshold: candidate.threshold },
      }),
    ]);
    result.notificationsSent += 1;
  }

  return result;
}
