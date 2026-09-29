import { describe, expect, it } from "vitest";
import { buildCsv, buildCsvRowLines, neutralizeFormula } from "../src/lib/csv";
import { complianceReportToCsv, type ComplianceReportRow } from "../src/lib/report-data";
import { ticketsToCsv } from "../src/lib/zendesk-concierge-export";

describe("neutralizeFormula (F-G)", () => {
  it.each(["=SUM(A1)", "+1+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "=HYPERLINK(\"http://x\")"])(
    "prefixes %j so a spreadsheet shows it as text",
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    },
  );

  it.each(["hello", "Order = 5", "a+b", "user@example.com", "", "2026-09-29T10:00:00Z", "'quoted"])(
    "leaves %j alone",
    (value) => {
      expect(neutralizeFormula(value)).toBe(value);
    },
  );

  it("leaves plain numbers and the app's own overdue durations alone", () => {
    for (const value of ["-15", "+2.5", "-0.5", "-12m", "-1h 5m", "-2d 3h 4m 5s", "-30s"]) {
      expect(neutralizeFormula(value)).toBe(value);
    }
  });

  it("does not exempt look-alikes that contain more than a number or duration", () => {
    for (const value of ["-1+1", "-12m+cmd", "-1h 5m=1", "-5 -5", "+1 555 0100"]) {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    }
  });
});

describe("buildCsv", () => {
  it("neutralizes string cells (before quoting) but never number cells", () => {
    const csv = buildCsv(["a", "b", "c"], [["=1+1", -5, null], ["@x,y", "-3m", "ok"]]);
    expect(csv).toBe("a,b,c\r\n'=1+1,-5,\r\n\"'@x,y\",-3m,ok\r\n");
  });

  it("applies to header-less streamed rows too", () => {
    expect(buildCsvRowLines([["+cmd", "x"]])).toBe("'+cmd,x\r\n");
  });
});

describe("the exports that write customer-controlled text", () => {
  it("compliance report: customer name and external id", () => {
    const row = {
      customerName: "=cmd|'/C calc'!A0",
      externalId: "@ticket",
      zendeskUrl: "https://x.zendesk.com/agent/tickets/1",
      jiraIssueKeys: [],
      linearIssueKeys: [],
      githubPullRequestKeys: [],
      kind: "resolution",
      status: "breached",
      targetMinutes: 60,
      elapsedWorkingMinutes: 61,
      breachedByMinutes: 1,
      openedAt: "2026-09-29T10:00:00.000Z",
      dueAt: "2026-09-29T11:00:00.000Z",
      closedAt: null,
    } as unknown as ComplianceReportRow;
    const csv = complianceReportToCsv([row]);
    expect(csv).toContain("'=cmd|'/C calc'!A0");
    expect(csv).toContain(",'@ticket,");
    expect(csv).not.toMatch(/(^|\r\n)=cmd/);
  });

  it("Zendesk concierge tickets CSV: subject and organization name", () => {
    const csv = ticketsToCsv({
      tickets: [
        {
          ticket: {
            id: 1,
            subject: "=HYPERLINK(\"http://evil\",\"x\")",
            status: "open",
            priority: null,
            created_at: "2026-09-29T10:00:00Z",
            updated_at: "2026-09-29T10:00:00Z",
            organization_id: 7,
            requester_id: 2,
            via: { channel: "email" },
            external_id: null,
          },
          audits: [],
        },
      ],
      organizationNames: new Map([[7, "+cmd"]]),
      jiraKeysByTicketId: new Map(),
    } as never);
    expect(csv).toContain("'=HYPERLINK(");
    expect(csv).toContain(",'+cmd,");
  });
});
