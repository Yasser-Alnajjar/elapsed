import { BREACH_NOTIFICATION_THRESHOLD } from "@sla/core";
import type { NotificationCandidate } from "@sla/commitments";
import type { EmailTemplateRequest } from "@sla/email";

export interface NotificationContext {
  externalId: string;
  customerName: string | null;
  /** The source ticket's subject/title (`Case.subject`) — optional since it postdates existing cases and not every ticket-source normalizer populates it. Shown in the HTML email body when present; omitted from the Slack message and email subject line to keep those short. */
  subject?: string | null;
  /**
   * Deep link to the ticket, e.g. `${appUrl}/cases/${caseId}` (3.9/E-19) —
   * shared by both channels, unlike `EmailBrand`'s cosmetic-only fields.
   * Null/undefined omits the link entirely (e.g. no `appUrl` configured).
   */
  caseUrl?: string | null;
}

/** Cosmetic-only inputs the builder needs beyond `NotificationContext`: nothing here affects dedup or delivery, so callers can omit it entirely. */
export interface EmailBrand {
  /** Named in the email's footer — the organization's configured SMTP "from name", when it set one. The email itself is always the Elapsed shell. */
  name?: string | null;
}

const KIND_LABEL: Record<NotificationCandidate["kind"], string> = {
  first_response: "First response",
  resolution: "Resolution",
  next_reply: "Next reply",
};

/** e.g. `2h 15m`, `45m`, `3h`. Always non-negative — callers decide sign. */
function formatMinutes(minutes: number): string {
  const abs = Math.max(0, Math.round(minutes));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** e.g. "Sep 17, 2026, 09:00 UTC" — fixed UTC so the instant reads the same regardless of the server's or reader's own timezone. */
function formatInstant(iso: string): string {
  const formatted = new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${formatted} UTC`;
}

/**
 * 3.9's shared alert context line — policy, target, start and (once
 * breached) breach time — in the given `parts` array, ready to `join`.
 */
function contextParts(
  candidate: NotificationCandidate,
  isBreach: boolean,
): string[] {
  const parts = [
    `Policy: ${candidate.policyName}`,
    `Target: ${formatMinutes(candidate.targetMinutes)}`,
    `Started: ${formatInstant(candidate.startedAt)}`,
  ];
  if (isBreach && candidate.breachedAt)
    parts.push(`Breached: ${formatInstant(candidate.breachedAt)}`);
  if (candidate.sourceStaleSince)
    parts.push(
      `Source data stale since: ${formatInstant(candidate.sourceStaleSince)}`,
    );
  return parts;
}

/**
 * Plain-text Slack message for one notification candidate. Pure and
 * side-effect free so message content can be unit tested without a Slack
 * workspace or a database.
 */
export function formatSlackMessage(
  candidate: NotificationCandidate,
  context: NotificationContext,
): string {
  const kindLabel = KIND_LABEL[candidate.kind];
  const who = context.customerName ? ` for ${context.customerName}` : "";
  const ticket = `#${context.externalId}`;
  const isBreach = candidate.threshold === BREACH_NOTIFICATION_THRESHOLD;

  const headline = isBreach
    ? `:rotating_light: *${kindLabel} SLA breached* — ${ticket}${who}, over target by ${formatMinutes(candidate.breachedByMinutes ?? 0)}.`
    : `:warning: *${kindLabel} SLA at risk* — ${ticket}${who}, ${candidate.threshold}% of target used, ${formatMinutes(candidate.remainingMinutes)} remaining.`;

  const metaLine = contextParts(candidate, isBreach).join(" · ");
  // Slack mrkdwn link syntax — E-19: Slack alerts previously carried no case
  // link at all, unlike email's "View ticket" button.
  const link = context.caseUrl ? `\n<${context.caseUrl}|View ticket>` : "";

  return `${headline}\n${metaLine}${link}`;
}

/**
 * The `sla-alert` email for one notification candidate — same inputs and the
 * same pure, side-effect-free shape as `formatSlackMessage` so it can be unit
 * tested without an SMTP server. It returns template data, not markup: the
 * subject, plain text and HTML are all produced by `@sla/email`'s layout when
 * the request is sent. Recipients are resolved by the dispatcher, not here.
 * `brand` is optional and cosmetic-only; omitting it still produces a fully
 * valid email, and omitting `context.caseUrl` simply leaves out the button.
 */
export function buildSlaAlertEmail(
  candidate: NotificationCandidate,
  context: NotificationContext,
  brand: EmailBrand = {},
): EmailTemplateRequest<"sla-alert"> {
  const isBreach = candidate.threshold === BREACH_NOTIFICATION_THRESHOLD;
  return {
    template: "sla-alert",
    data: {
      severity: isBreach ? "breach" : "at_risk",
      kindLabel: KIND_LABEL[candidate.kind],
      ticketLabel: `#${context.externalId}`,
      ticketName: context.subject,
      customerName: context.customerName,
      figureText: formatMinutes(isBreach ? (candidate.breachedByMinutes ?? 0) : candidate.remainingMinutes),
      ...(isBreach ? {} : { thresholdPercent: candidate.threshold }),
      targetText: formatMinutes(candidate.targetMinutes),
      policyName: candidate.policyName,
      startedText: formatInstant(candidate.startedAt),
      ...(isBreach && candidate.breachedAt ? { breachedText: formatInstant(candidate.breachedAt) } : {}),
      ...(candidate.sourceStaleSince ? { sourceStaleSinceText: formatInstant(candidate.sourceStaleSince) } : {}),
      caseUrl: context.caseUrl,
      senderName: brand.name?.trim() || null,
    },
  };
}
