import { defineEmailTemplate } from "../template";
import type { EmailBlock, Stat, TableRow } from "../blocks";

/**
 * The monthly SLA report email. The report's figures are computed and
 * formatted by the caller; this template lays them out. The full breach list
 * travels as a CSV attachment on the message, not in the template.
 */
export interface MonthlyReportData {
  organizationName: string;
  /** e.g. "September 2026". */
  periodLabel: string;
  timezone: string;
  /** The headline figures, side by side. */
  overview: Stat[];
  compliance: TableRow[];
  /** Where the clock was when commitments were breached. Empty renders "No breaches this month." */
  stages: TableRow[];
  /** Empty renders "None." */
  topCustomers: TableRow[];
  linkCoverage: string;
  /** Set when the attached CSV holds only the first part of the month's breaches. */
  csvNote?: string | null;
  caseListUrl?: string | null;
}

function group(title: string, rows: TableRow[], emptyText: string): EmailBlock[] {
  return [{ type: "section", title }, rows.length === 0 ? { type: "text", muted: true, text: emptyText } : { type: "table", rows }];
}

export const monthlyReportTemplate = defineEmailTemplate<MonthlyReportData>({
  category: "reports",
  notificationSettingsLink: true,
  subject: ({ organizationName, periodLabel }) => `${organizationName}: SLA report for ${periodLabel}`,
  preheader: ({ organizationName, periodLabel }) => `${organizationName}: your SLA report for ${periodLabel}.`,
  footnote: ({ organizationName }) =>
    `You are receiving this monthly report as a member of ${organizationName}. The full breach list is attached as CSV.`,
  content: (data) => {
    const blocks: EmailBlock[] = [
      { type: "badge", tone: "info", text: "Monthly SLA report" },
      { type: "heading", text: `SLA report for ${data.periodLabel}`, subtitle: `${data.organizationName} · ${data.timezone}` },
      { type: "stats", cells: data.overview },
      ...group("Compliance by commitment", data.compliance, "None."),
      ...group("Time by stage", data.stages, "No breaches this month."),
      ...group("Customers with the most breaches", data.topCustomers, "None."),
      { type: "section", title: "Link coverage" },
      { type: "text", text: data.linkCoverage },
    ];
    if (data.csvNote) blocks.push({ type: "note", text: data.csvNote });
    if (data.caseListUrl) blocks.push({ type: "button", label: "View breached cases", url: data.caseListUrl });
    return blocks;
  },
});
