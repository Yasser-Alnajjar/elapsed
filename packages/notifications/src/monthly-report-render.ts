import { buildCsv, type CommitmentKind, type Leg } from "@sla/core";
import type { EmailAttachment, EmailSwatch, EmailTemplateRequest, MonthlyReportData } from "@sla/email";
import { MAX_REPORT_BREACH_ROWS, type MonthlyReport } from "./monthly-report";

/**
 * Prepares a `MonthlyReport` for each channel: the email (template data for
 * `@sla/email`'s `monthly-report` template, plus a CSV attachment) and a Slack
 * message. Neutral language throughout: stages are places where time was
 * spent, never parties at fault. Nothing here writes markup or a plain-text
 * body for the email; the shared layout renders both.
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

/** The stage colors the email draws next to "Time by stage". */
const STAGE_SWATCH: Record<Leg, EmailSwatch> = {
  support: "support",
  engineering: "engineering",
  waiting_customer: "waiting",
  unknown: "neutral",
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

/** The `monthly-report` email: figures formatted for reading, laid out by the template. */
export function buildMonthlyReportEmail(report: MonthlyReport): EmailTemplateRequest<"monthly-report"> {
  const data: MonthlyReportData = {
    organizationName: report.organizationName,
    periodLabel: formatPeriod(report.period),
    timezone: report.timezone,
    overview: [
      { label: "Cases opened", value: report.casesOpened.toLocaleString("en-US") },
      { label: "Met", value: report.overall.met.toLocaleString("en-US") },
      { label: "Breached", value: report.overall.breached.toLocaleString("en-US"), ...(report.overall.breached > 0 ? { tone: "danger" as const } : {}) },
      { label: "Compliance", value: formatPercent(report.overall.compliancePercent), tone: "info" },
    ],
    compliance: report.complianceByKind.map((row) => ({
      label: KIND_LABEL[row.kind],
      value: `${formatPercent(row.compliancePercent)} (${row.met} met, ${row.breached} breached)`,
    })),
    stages: report.breachesByStage.map((row) => ({ label: STAGE_LABEL[row.leg], value: plural(row.count, "breach", "breaches"), swatch: STAGE_SWATCH[row.leg] })),
    topCustomers: report.topCustomers.map((row) => ({ label: row.customerName, value: plural(row.breaches, "breach", "breaches") })),
    linkCoverage: `${formatRatio(report.linkCoverage.ratio)}: ${report.linkCoverage.linkedCases} of ${report.linkCoverage.cases} cases from the last 30 days of the month are linked to engineering work. Only certain links count.`,
    csvNote:
      truncated(report) > 0
        ? `The attached CSV lists the first ${MAX_REPORT_BREACH_ROWS.toLocaleString("en-US")} breaches of ${report.overall.breached.toLocaleString("en-US")}.`
        : null,
    caseListUrl: report.caseListUrl,
  };
  return { template: "monthly-report", data };
}

/** The breaches of the month as the email's CSV attachment. */
export function monthlyReportCsvAttachment(report: MonthlyReport): EmailAttachment {
  return { filename: monthlyReportCsvFilename(report), content: renderMonthlyReportCsv(report), contentType: "text/csv; charset=utf-8" };
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
