/**
 * Branded HTML wrapper for notification emails. Table-based, inline-styled
 * layout (no `<style>` block, no external assets) because that's what
 * survives Outlook/Gmail's HTML sanitizing — a `<link>`ed stylesheet or
 * `<style>` rules get stripped by enough clients that inlining is the only
 * reliable option for email.
 */

export type EmailSeverity = "breach" | "at_risk";

export interface EmailTemplateInput {
  brandName: string;
  severity: EmailSeverity;
  heading: string;
  ticketLabel: string;
  /** The ticket's subject/title (`Case.subject`), when the source ticket has one. Shown as the primary line above the ticket number instead of duplicating it. */
  ticketName?: string | null;
  customerName: string | null;
  /** Pre-built inline HTML (e.g. `Over target by <strong>2h</strong>.`) — built from formatted numbers and constant labels only, never from free-text customer/ticket data, so it's trusted and passed through unescaped. */
  detailLine: string;
  caseUrl?: string | null;
  /**
   * 3.9's alert context — the matched policy's own name (`SLAPolicy.name`),
   * free text and escaped here, unlike `targetText`/`startedText`/
   * `breachedText` below (algorithmically formatted durations/instants, safe
   * to interpolate as-is).
   */
  policyName?: string;
  targetText?: string;
  startedText?: string;
  breachedText?: string;
}

const SEVERITY_STYLE: Record<
  EmailSeverity,
  { accent: string; tint: string; label: string }
> = {
  breach: { accent: "#dc2626", tint: "#fef2f2", label: "SLA BREACHED" },
  at_risk: { accent: "#d97706", tint: "#fffbeb", label: "SLA AT RISK" },
};

/** Minimal, dependency-free escaping — every dynamic value here is plain text dropped into an HTML body, never markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderNotificationEmailHtml(input: EmailTemplateInput): string {
  const { accent, tint, label } = SEVERITY_STYLE[input.severity];
  const brandName = escapeHtml(input.brandName);
  const heading = escapeHtml(input.heading);
  const ticketLabel = escapeHtml(input.ticketLabel);
  const detailLine = input.detailLine;
  const ticketRow = input.ticketName
    ? `<tr><td style="padding-bottom:2px;color:#0f172a;font-size:16px;font-weight:700;">${escapeHtml(input.ticketName)}</td></tr>
       <tr><td style="padding-bottom:4px;color:#64748b;font-size:13px;">Ticket ${ticketLabel}</td></tr>`
    : `<tr><td style="padding-bottom:4px;color:#0f172a;font-size:15px;">Ticket <span style="font-weight:700;">${ticketLabel}</span></td></tr>`;
  const customerRow = input.customerName
    ? `<tr><td style="padding:2px 0;color:#64748b;font-size:14px;">Customer: <span style="color:#0f172a;font-weight:600;">${escapeHtml(input.customerName)}</span></td></tr>`
    : "";
  const metaParts = [
    input.policyName ? `Policy: <span style="color:#0f172a;font-weight:600;">${escapeHtml(input.policyName)}</span>` : null,
    input.targetText ? `Target: <span style="color:#0f172a;font-weight:600;">${escapeHtml(input.targetText)}</span>` : null,
    input.startedText ? `Started: <span style="color:#0f172a;font-weight:600;">${escapeHtml(input.startedText)}</span>` : null,
    input.breachedText ? `Breached: <span style="color:#0f172a;font-weight:600;">${escapeHtml(input.breachedText)}</span>` : null,
  ].filter((part): part is string => part !== null);
  const metaRow =
    metaParts.length > 0
      ? `<tr><td style="padding-top:10px;color:#64748b;font-size:13px;line-height:1.7;">${metaParts.join(" &middot; ")}</td></tr>`
      : "";
  const ctaButton = input.caseUrl
    ? `<tr><td style="padding-top:24px;">
        <a href="${escapeHtml(input.caseUrl)}" style="display:inline-block;background-color:#0f172a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:6px;">View ticket</a>
      </td></tr>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background-color:#0f172a;padding:16px 24px;">
                <span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.01em;">${brandName}</span>
              </td>
            </tr>
            <tr>
              <td style="background-color:${tint};border-bottom:1px solid #e2e8f0;padding:8px 24px;">
                <span style="color:${accent};font-size:12px;font-weight:700;letter-spacing:0.06em;">${label}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding-bottom:12px;color:#0f172a;font-size:19px;font-weight:700;">${heading}</td></tr>
                  ${ticketRow}
                  ${customerRow}
                  <tr><td style="padding-top:14px;color:#334155;font-size:14px;line-height:1.5;">${detailLine}</td></tr>
                  ${metaRow}
                  ${ctaButton}
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 24px;">
                <span style="color:#94a3b8;font-size:12px;">Automated SLA notification from ${brandName}.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
