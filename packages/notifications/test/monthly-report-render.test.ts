import { describe, expect, it } from "vitest";
import type { MonthlyReport } from "../src/monthly-report";
import {
  monthlyReportCsvFilename,
  monthlyReportSubject,
  renderMonthlyReportCsv,
  renderMonthlyReportHtml,
  renderMonthlyReportSlack,
  renderMonthlyReportText,
} from "../src/monthly-report-render";

const report: MonthlyReport = {
  organizationId: "org_1",
  organizationName: "Acme Support",
  period: "2026-09",
  timezone: "Europe/Berlin",
  start: "2026-08-31T22:00:00.000Z",
  end: "2026-09-30T22:00:00.000Z",
  complianceByKind: [
    { kind: "first_response", met: 90, breached: 10, compliancePercent: 90 },
    { kind: "next_reply", met: 40, breached: 10, compliancePercent: 80 },
    { kind: "resolution", met: 0, breached: 0, compliancePercent: null },
  ],
  overall: { met: 130, breached: 20, compliancePercent: 86.7 },
  breachesByStage: [
    { leg: "support", count: 14 },
    { leg: "engineering", count: 6 },
  ],
  topCustomers: [{ customerName: "Globex", breaches: 7 }],
  casesOpened: 318,
  linkCoverage: { cases: 318, linkedCases: 214, ratio: 214 / 318 },
  breaches: [
    { customerName: "Globex", ticketId: "1042", kind: "first_response", targetMinutes: 60, breachedAt: "2026-09-03T10:00:00.000Z", stage: "support" },
  ],
  caseListUrl: "https://app.example.com/cases?breached=1",
  generatedAt: "2026-10-01T06:00:00.000Z",
};

const renders = () => ({
  text: renderMonthlyReportText(report),
  html: renderMonthlyReportHtml(report),
  slack: renderMonthlyReportSlack(report),
  csv: renderMonthlyReportCsv(report),
  subject: monthlyReportSubject(report),
});

describe("monthly report rendering", () => {
  it("states the figures the plan asks for: compliance, time by stage, top customers, link coverage, case list", () => {
    const { text } = renders();
    expect(text).toContain("90"); // first response compliance
    expect(text).toContain("Globex");
    expect(text).toMatch(/214 of 318/);
    expect(text).toContain("https://app.example.com/cases?breached=1");
    expect(text).toMatch(/support/i);
    expect(text).toMatch(/engineering/i);
  });

  it("uses neutral language everywhere: where time was spent, never who is at fault", () => {
    for (const [name, output] of Object.entries(renders())) {
      expect(output, name).not.toMatch(/\b(blame|fault|responsible|culprit|negligen\w*)\b/i);
    }
  });

  it("names the period and file after the month, and the CSV carries no case subject or message text", () => {
    const { subject, csv } = renders();
    expect(subject).toContain("September 2026");
    expect(monthlyReportCsvFilename(report)).toContain("2026-09");
    expect(csv.split("\n")[0]).not.toMatch(/subject|message|body/i);
    expect(csv).toContain("1042");
  });

  it("escapes markup in names rendered into HTML", () => {
    const html = renderMonthlyReportHtml({ ...report, topCustomers: [{ customerName: "<script>x</script>", breaches: 1 }] });
    expect(html).not.toContain("<script>x</script>");
  });
});
