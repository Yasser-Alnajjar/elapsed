import { BREACH_NOTIFICATION_THRESHOLD } from "@sla/core";
import type { NotificationCandidate } from "@sla/commitments";
import { renderNotificationEmailHtml } from "./email-template";

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

/** Falls back to this when the organization hasn't set an SMTP "from name" — the email still needs a brand to show in its header. */
export const DEFAULT_EMAIL_BRAND_NAME = "SLA Breach Monitoring";

/** Cosmetic-only inputs the formatter needs beyond `NotificationContext`: nothing here affects dedup or delivery, so callers can omit it entirely. */
export interface EmailBrand {
  /** Shown in the email header and footer — the organization's configured SMTP "from name", or `DEFAULT_EMAIL_BRAND_NAME`. */
  name?: string | null;
}

/** Recipients are resolved by the dispatcher, not the formatter — mirrors `formatSlackMessage` not knowing the channel. */
export interface EmailContent {
  subject: string;
  text: string;
  html: string;
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
function contextParts(candidate: NotificationCandidate, isBreach: boolean): string[] {
  const parts = [
    `Policy: ${candidate.policyName}`,
    `Target: ${formatMinutes(candidate.targetMinutes)}`,
    `Started: ${formatInstant(candidate.startedAt)}`,
  ];
  if (isBreach && candidate.breachedAt) parts.push(`Breached: ${formatInstant(candidate.breachedAt)}`);
  if (candidate.sourceStaleSince) parts.push(`Source data stale since: ${formatInstant(candidate.sourceStaleSince)}`);
  return parts;
}

/**
 * Plain-text Slack message for one notification candidate. Pure and
 * side-effect free so message content can be unit tested without a Slack
 * workspace or a database.
 */
export function formatSlackMessage(candidate: NotificationCandidate, context: NotificationContext): string {
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
 * Subject/text/HTML for one notification email — same inputs and the same
 * pure, side-effect-free shape as `formatSlackMessage` so it can be unit
 * tested without an SMTP server. `brand` is optional and cosmetic-only
 * (header name + ticket link in the HTML body); omitting it still produces
 * a fully valid email with the default brand name and no CTA button.
 */
export function formatEmailMessage(
  candidate: NotificationCandidate,
  context: NotificationContext,
  brand: EmailBrand = {},
): EmailContent {
  const kindLabel = KIND_LABEL[candidate.kind];
  const who = context.customerName ? ` (${context.customerName})` : "";
  const ticket = `#${context.externalId}`;
  const brandName = brand.name?.trim() || DEFAULT_EMAIL_BRAND_NAME;
  const isBreach = candidate.threshold === BREACH_NOTIFICATION_THRESHOLD;

  // 3.9: policy, target, start and (once breached) breach time — the same
  // context Slack now carries, joined into the plain-text body and passed
  // as structured fields to the HTML template (which escapes `policyName`).
  const meta = contextParts(candidate, isBreach);
  const metaText = meta.join(" · ");
  const targetText = formatMinutes(candidate.targetMinutes);
  const startedText = formatInstant(candidate.startedAt);
  const breachedText = isBreach && candidate.breachedAt ? formatInstant(candidate.breachedAt) : undefined;

  if (isBreach) {
    const over = formatMinutes(candidate.breachedByMinutes ?? 0);
    const detailLine = `Over target by <strong>${over}</strong>.`;
    return {
      subject: `SLA breached: ${kindLabel} on ${ticket}${who}`,
      text: `${kindLabel} SLA breached on ticket ${ticket}${who}.\n\nOver target by ${over}.\n\n${metaText}`,
      html: renderNotificationEmailHtml({
        brandName,
        severity: "breach",
        heading: `${kindLabel} SLA breached`,
        ticketLabel: ticket,
        ticketName: context.subject,
        customerName: context.customerName,
        detailLine,
        caseUrl: context.caseUrl,
        policyName: candidate.policyName,
        targetText,
        startedText,
        breachedText,
      }),
    };
  }

  const remaining = formatMinutes(candidate.remainingMinutes);
  const detailLine = `<strong>${candidate.threshold}%</strong> of target used, <strong>${remaining}</strong> remaining.`;
  return {
    subject: `SLA at risk: ${kindLabel} on ${ticket}${who}`,
    text: `${kindLabel} SLA at risk on ticket ${ticket}${who}.\n\n${candidate.threshold}% of target used, ${remaining} remaining.\n\n${metaText}`,
    html: renderNotificationEmailHtml({
      brandName,
      severity: "at_risk",
      heading: `${kindLabel} SLA at risk`,
      ticketLabel: ticket,
      ticketName: context.subject,
      customerName: context.customerName,
      detailLine,
      caseUrl: context.caseUrl,
      policyName: candidate.policyName,
      targetText,
      startedText,
    }),
  };
}
