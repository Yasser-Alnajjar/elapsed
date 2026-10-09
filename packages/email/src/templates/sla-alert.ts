import { defineEmailTemplate } from "../template";
import { strong, type DetailRow, type EmailBlock } from "../blocks";

export type SlaAlertSeverity = "breach" | "at_risk";

/**
 * One SLA breach / at-risk notification. Every figure arrives already
 * formatted (durations, UTC instants) by the caller, which owns the SLA
 * arithmetic; this template only decides how it reads.
 */
export interface SlaAlertData {
  severity: SlaAlertSeverity;
  /** "First response", "Next reply" or "Resolution". */
  kindLabel: string;
  /** e.g. `#4821`. */
  ticketLabel: string;
  /** The ticket's own title, when its source has one. */
  ticketName?: string | null;
  customerName?: string | null;
  /** Breach: how far over target (`2h 10m`). At risk: time left (`45m`). */
  figureText: string;
  /** At risk only: how much of the target is used. */
  thresholdPercent?: number;
  targetText: string;
  policyName?: string;
  startedText?: string;
  breachedText?: string;
  sourceStaleSinceText?: string;
  /** A caveat for a figure computed on incomplete data (a source with no status history). */
  caveatText?: string;
  /** Deep link to the case; omitted when the deployment has no public URL. */
  caseUrl?: string | null;
  /** Who the alert is sent on behalf of: the organization's configured "from name". */
  senderName?: string | null;
}

const SEVERITY = {
  breach: { tone: "danger", badge: "SLA breached", state: "SLA breached", metricLabel: "Breach overage" },
  at_risk: { tone: "warning", badge: "SLA at risk", state: "SLA at risk", metricLabel: "Remaining runway" },
} as const;

export const slaAlertTemplate = defineEmailTemplate<SlaAlertData>({
  category: "operations",
  notificationSettingsLink: true,
  subject: ({ severity, kindLabel, ticketLabel, customerName }) =>
    `${SEVERITY[severity].state}: ${kindLabel} on ${ticketLabel}${customerName ? ` (${customerName})` : ""}`,
  preheader: ({ severity, kindLabel, ticketLabel }) => `${kindLabel} ${SEVERITY[severity].state} on ticket ${ticketLabel}.`,
  footnote: ({ senderName }) => `You are receiving this notification because SLA alerts are enabled for ${senderName?.trim() || "your organization"}.`,
  content: (data) => {
    const { severity, kindLabel, ticketLabel, ticketName, customerName } = data;
    const state = SEVERITY[severity];
    const blocks: EmailBlock[] = [
      { type: "badge", tone: state.tone, text: state.badge },
      {
        type: "heading",
        text: `${kindLabel} ${state.state}`,
        subtitle: [customerName, `Ticket ${ticketLabel}`].filter(Boolean).join(" · "),
      },
    ];
    if (ticketName) blocks.push({ type: "text", text: [strong(ticketName)] });
    blocks.push({
      type: "metric",
      tone: state.tone,
      label: state.metricLabel,
      value: severity === "breach" ? `+${data.figureText}` : data.figureText,
      aside: { label: "Committed target", value: data.targetText },
    });

    const rows: DetailRow[] = [];
    if (customerName) rows.push({ label: "Customer", value: customerName });
    if (data.policyName) rows.push({ label: "Policy", value: data.policyName });
    if (data.startedText) rows.push({ label: "Started", value: data.startedText });
    if (data.breachedText) rows.push({ label: "Breached", value: data.breachedText });
    if (data.sourceStaleSinceText) rows.push({ label: "Source data stale since", value: data.sourceStaleSinceText });
    if (rows.length > 0) blocks.push({ type: "details", rows });

    if (data.caveatText) blocks.push({ type: "note", text: [data.caveatText] });
    if (data.caseUrl) blocks.push({ type: "button", label: "View ticket", url: data.caseUrl });
    blocks.push({
      type: "note",
      text:
        severity === "breach"
          ? ["Over target by ", strong(data.figureText), "."]
          : [strong(`${data.thresholdPercent ?? 0}%`), " of target used, ", strong(data.figureText), " remaining."],
    });
    return blocks;
  },
});
