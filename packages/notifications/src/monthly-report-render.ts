import { buildCsv, type CommitmentKind, type Leg } from "@sla/core";
import { escapeHtml } from "./email-template";
import { DEFAULT_EMAIL_BRAND_NAME } from "./format";
import { MAX_REPORT_BREACH_ROWS, type MonthlyReport } from "./monthly-report";

/**
 * Renders a `MonthlyReport` for each channel: email (subject, plain text,
 * HTML, a CSV attachment) and a Slack message. Neutral language throughout:
 * stages are places where time was spent, never parties at fault.
 */

const KIND_LABEL: Record<CommitmentKind, string> = {
  first_response: "First response",
  next_reply: "Next reply",
  resolution: "Resolution",
};

/** "Time by stage" labels: where the clock was, in the customer's terms. */
const STAGE_LABEL: Record<Leg, string> = {
  support: "Support",
  engineering: "Engineering",
  waiting_customer: "Waiting on customer",
  unknown: "Not attributed",
};

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-09` -> "September 2026". */
export function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
}

const formatPercent = (value: number | null) => (value === null ? "n/a" : `${value}%`);
const formatRatio = (ratio: number | null) => (ratio === null ? "n/a" : `${Math.round(ratio * 100)}%`);

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

export function monthlyReportSubject(report: MonthlyReport): string {
  return `${report.organizationName}: SLA report for ${formatPeriod(report.period)}`;
}

export function monthlyReportCsvFilename(report: MonthlyReport): string {
  return `sla-report-${report.period}.csv`;
}

/** The breaches of the month, one per row. Free text such as case subjects is never included. */
export function renderMonthlyReportCsv(report: MonthlyReport): string {
  return buildCsv(
    ["Customer", "Ticket", "Commitment", "Target (minutes)", "Breached at (UTC)", "Stage at breach"],
    report.breaches.map((row) => [
      row.customerName ?? "",
      row.ticketId,
      KIND_LABEL[row.kind],
      row.targetMinutes,
      row.breachedAt,
      STAGE_LABEL[row.stage],
    ]),
  );
}

function truncated(report: MonthlyReport): number {
  return Math.max(0, report.overall.breached - report.breaches.length);
}

/** The plain-text body, also the fallback for clients that cannot show HTML. */
export function renderMonthlyReportText(report: MonthlyReport): string {
  const lines: string[] = [`SLA report for ${formatPeriod(report.period)} (${report.timezone})`, report.organizationName, ""];

  lines.push(
    `Commitments met: ${report.overall.met.toLocaleString("en-US")}. Breached: ${report.overall.breached.toLocaleString("en-US")}. Compliance: ${formatPercent(report.overall.compliancePercent)}.`,
    `Cases opened: ${report.casesOpened.toLocaleString("en-US")}.`,
    "",
    "Compliance by commitment",
  );
  for (const row of report.complianceByKind) {
    lines.push(`- ${KIND_LABEL[row.kind]}: ${formatPercent(row.compliancePercent)} (${row.met} met, ${row.breached} breached)`);
  }

  lines.push("", "Time by stage (where the clock was when a commitment was breached)");
  if (report.breachesByStage.length === 0) lines.push("- No breaches this month.");
  for (const row of report.breachesByStage) lines.push(`- ${STAGE_LABEL[row.leg]}: ${plural(row.count, "breach", "breaches")}`);

  lines.push("", "Customers with the most breaches");
  if (report.topCustomers.length === 0) lines.push("- None.");
  for (const row of report.topCustomers) lines.push(`- ${row.customerName}: ${plural(row.breaches, "breach", "breaches")}`);

  lines.push(
    "",
    `Link coverage: ${formatRatio(report.linkCoverage.ratio)} (${report.linkCoverage.linkedCases} of ${report.linkCoverage.cases} cases from the last 30 days of the month are linked to engineering work). Only certain links count.`,
  );
  if (truncated(report) > 0) {
    lines.push("", `The attached CSV lists the first ${MAX_REPORT_BREACH_ROWS.toLocaleString("en-US")} breaches of ${report.overall.breached.toLocaleString("en-US")}.`);
  }
  if (report.caseListUrl) lines.push("", `View the breached cases: ${report.caseListUrl}`);
  return lines.join("\n");
}

const CELL = "padding:7px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;";
const CELL_RIGHT = `${CELL}text-align:right;font-variant-numeric:tabular-nums;`;
const HEADING = "padding:22px 0 6px;font-size:12px;font-weight:700;letter-spacing:0.06em;color:#64748b;text-transform:uppercase;";

function table(rows: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>`;
}

function row(label: string, value: string): string {
  return `<tr><td style="${CELL}">${escapeHtml(label)}</td><td style="${CELL_RIGHT}">${escapeHtml(value)}</td></tr>`;
}

/** Table-based, inline-styled HTML like the alert email: no `<style>` block, no external assets. */
export function renderMonthlyReportHtml(report: MonthlyReport, brandName: string = DEFAULT_EMAIL_BRAND_NAME): string {
  const brand = escapeHtml(brandName);
  const sections: string[] = [];

  sections.push(
    `<tr><td style="padding-bottom:4px;color:#0f172a;font-size:19px;font-weight:700;">SLA report for ${escapeHtml(formatPeriod(report.period))}</td></tr>`,
    `<tr><td style="color:#64748b;font-size:13px;">${escapeHtml(report.organizationName)} &middot; ${escapeHtml(report.timezone)}</td></tr>`,
    `<tr><td style="padding-top:16px;color:#334155;font-size:14px;line-height:1.6;">
      <strong>${report.overall.met.toLocaleString("en-US")}</strong> commitments met,
      <strong>${report.overall.breached.toLocaleString("en-US")}</strong> breached
      (${escapeHtml(formatPercent(report.overall.compliancePercent))} compliance) across
      ${escapeHtml(plural(report.casesOpened, "case", "cases"))} opened.
    </td></tr>`,
  );

  sections.push(`<tr><td style="${HEADING}">Compliance by commitment</td></tr>`);
  sections.push(
    `<tr><td>${table(
      report.complianceByKind.map((r) => row(KIND_LABEL[r.kind], `${formatPercent(r.compliancePercent)} (${r.met} met, ${r.breached} breached)`)),
    )}</td></tr>`,
  );

  sections.push(`<tr><td style="${HEADING}">Time by stage</td></tr>`);
  sections.push(
    report.breachesByStage.length === 0
      ? `<tr><td style="${CELL}">No breaches this month.</td></tr>`
      : `<tr><td>${table(report.breachesByStage.map((r) => row(STAGE_LABEL[r.leg], plural(r.count, "breach", "breaches"))))}</td></tr>`,
  );

  sections.push(`<tr><td style="${HEADING}">Customers with the most breaches</td></tr>`);
  sections.push(
    report.topCustomers.length === 0
      ? `<tr><td style="${CELL}">None.</td></tr>`
      : `<tr><td>${table(report.topCustomers.map((r) => row(r.customerName, plural(r.breaches, "breach", "breaches"))))}</td></tr>`,
  );

  sections.push(`<tr><td style="${HEADING}">Link coverage</td></tr>`);
  sections.push(
    `<tr><td style="${CELL}">${escapeHtml(formatRatio(report.linkCoverage.ratio))}: ${report.linkCoverage.linkedCases} of ${report.linkCoverage.cases} cases from the last 30 days of the month are linked to engineering work. Only certain links count.</td></tr>`,
  );

  if (truncated(report) > 0) {
    sections.push(
      `<tr><td style="padding-top:12px;color:#64748b;font-size:13px;">The attached CSV lists the first ${MAX_REPORT_BREACH_ROWS.toLocaleString("en-US")} breaches of ${report.overall.breached.toLocaleString("en-US")}.</td></tr>`,
    );
  }
  if (report.caseListUrl) {
    sections.push(
      `<tr><td style="padding-top:24px;"><a href="${escapeHtml(report.caseListUrl)}" style="display:inline-block;background-color:#0f172a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:6px;">View breached cases</a></td></tr>`,
    );
  }

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr><td style="background-color:#0f172a;padding:16px 24px;"><span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.01em;">${brand}</span></td></tr>
            <tr>
              <td style="padding:28px 24px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${sections.join("\n                  ")}
                </table>
              </td>
            </tr>
            <tr><td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 24px;"><span style="color:#94a3b8;font-size:12px;">Monthly SLA report from ${brand}. Full breach list attached as CSV.</span></td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** The Slack message: a short summary and a link, since the detail is in the email and the app. */
export function renderMonthlyReportSlack(report: MonthlyReport): string {
  const link = report.caseListUrl ? `\n<${report.caseListUrl}|View breached cases>` : "";
  const worstStage = report.breachesByStage[0];
  const stage = worstStage ? ` Most breaches happened while a case was in ${STAGE_LABEL[worstStage.leg].toLowerCase()} (${worstStage.count}).` : "";
  return (
    `*SLA report for ${formatPeriod(report.period)}: ${report.organizationName}*\n` +
    `${report.overall.met.toLocaleString("en-US")} commitments met, ${report.overall.breached.toLocaleString("en-US")} breached ` +
    `(${formatPercent(report.overall.compliancePercent)} compliance).${stage}` +
    link
  );
}
