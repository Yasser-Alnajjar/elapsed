import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Findings } from "../src/analyze";
import { run, UsageError } from "../src/cli";
import { parseCsv } from "../src/csv";
import { parseJiraExport, parseStatusOverrides } from "../src/jira";
import { buildPolicyVersions, parseResolutionTargets } from "../src/policy";
import { parseZendeskExport } from "../src/zendesk";

/**
 * Synthetic export in test/fixtures, with every expected number worked out
 * by hand (UTC, 24/7 unless a test says otherwise, as of 2026-09-05 12:00):
 *
 * - #1001 urgent (4h), Acme, linked from SUP-1's "Zendesk Ticket IDs".
 *   Open 09-01 09:00 → solved 09-02 09:00 = 24h, breached by 20h. SUP-1 was
 *   created 10:00 and went Done 09-02 08:00: support 1h, engineering 22h,
 *   support 1h. The 4h target passed at 13:00, in engineering. Zendesk: Yes.
 * - #1002 high (8h), Globex, not escalated. Pending 10:00–18:00 pauses the
 *   clock: 1h + 2h = 3h, met. Zendesk says breached (it doesn't pause).
 * - #1003 normal (24h), Acme, linked from SUP-2's remote link URL. Still
 *   open: 48h elapsed, breached by 24h. Engineering since SUP-2's creation
 *   09-03 13:00, so 47h. Zendesk says not breached.
 * - #1004 low (24h), Initech, links SUP-3 from the ticket side. Solved
 *   after 2h, met. SUP-3's "QA Review" status needs --jira-status.
 * - #1005 is solved with no audit rows: not evaluated.
 * - SUP-4 references nothing, SUP-5 references ticket 9999 (not in the
 *   export), SUP-6 links another tenant's Zendesk.
 */
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const baseArgs = [
  "--zendesk-tickets", fixture("zendesk-tickets.csv"),
  "--zendesk-audits", fixture("zendesk-audits.csv"),
  "--jira-issues", fixture("jira-issues.csv"),
  "--jira-changelog", fixture("jira-changelog.csv"),
  "--resolution", "urgent=4h,high=8h,default=24h",
  "--as-of", "2026-09-05T12:00:00Z",
];

function analyze(extra: string[] = []): Findings {
  const { findings } = run([...baseArgs, "--format", "json", ...extra]);
  return findings!;
}

const byTicket = (findings: Findings, id: string) => findings.cases.find((c) => c.ticketId === id)!;

describe("concierge analysis on the synthetic export", () => {
  const findings = analyze(["--zendesk-subdomain", "acme", "--jira-status", "QA Review=indeterminate"]);

  it("evaluates each ticket's resolution target with the core engine", () => {
    expect(byTicket(findings, "1001")).toMatchObject({ status: "breached", breachedByMinutes: 1200, targetMinutes: 240 });
    expect(byTicket(findings, "1002")).toMatchObject({ status: "met", targetMinutes: 480 });
    expect(byTicket(findings, "1003")).toMatchObject({ status: "breached", breachedByMinutes: 1440, closedAt: null });
    expect(byTicket(findings, "1004")).toMatchObject({ status: "met", targetMinutes: 1440 });
    expect(byTicket(findings, "1005")).toMatchObject({ status: null, targetMinutes: null });
    expect(findings.dataQuality.closedTicketsWithoutHistory).toEqual(["1005"]);
    expect(findings.ticketsWithoutTarget).toBe(0);
  });

  it("compares escalated tickets with the ones that stayed in support", () => {
    expect(findings.tickets).toBe(5);
    expect(findings.escalated).toEqual({ cases: 3, evaluated: 3, breached: 2 });
    expect(findings.notEscalated).toEqual({ cases: 2, evaluated: 1, breached: 0 });
  });

  it("links on the deterministic tier only and reports coverage by reason", () => {
    expect(byTicket(findings, "1001").jiraKeys).toEqual(["SUP-1"]);
    expect(byTicket(findings, "1003").jiraKeys).toEqual(["SUP-2"]);
    expect(byTicket(findings, "1004").jiraKeys).toEqual(["SUP-3"]);
    expect(findings.coverage).toEqual({
      jiraIssues: 6,
      issuesReferencingTicket: 4,
      issuesLinked: 3,
      issuesTicketNotInExport: 1,
      issuesNotZendeskReference: 1,
      issuesUrlWithoutSubdomain: 0,
      ticketReferencesIssueNotInExport: 0,
      ticketsLinked: 3,
    });
  });

  it("splits time by leg and finds who held the ticket at the breach", () => {
    expect(byTicket(findings, "1001").legMinutes).toEqual({ support: 120, engineering: 1320, waiting_customer: 0, unknown: 0 });
    expect(byTicket(findings, "1002").legMinutes).toMatchObject({ support: 180, waiting_customer: 480 });
    expect(byTicket(findings, "1003").legMinutes).toMatchObject({ support: 60, engineering: 2820 });
    expect(findings.legTotals).toEqual({ support: 240, engineering: 4200, waiting_customer: 0, unknown: 0 });
    expect(findings.breachLegs).toEqual({ support: 0, engineering: 2, waiting_customer: 0, unknown: 0 });
  });

  it("lists where Zendesk's own breach flag disagrees with the engine", () => {
    expect(findings.zendeskTimer.columnPresent).toBe(true);
    expect(findings.zendeskTimer.compared).toBe(3);
    expect(findings.zendeskTimer.agree).toBe(1);
    expect(findings.zendeskTimer.engineBreachedZendeskNot.map((c) => c.ticketId)).toEqual(["1003"]);
    expect(findings.zendeskTimer.zendeskBreachedEngineNot.map((c) => c.ticketId)).toEqual(["1002"]);
  });

  it("lists open escalations aging in engineering, and top accounts", () => {
    expect(findings.agingInEngineering.total).toBe(1);
    expect(findings.agingInEngineering.cases[0]).toMatchObject({ ticketId: "1003", currentLeg: "engineering" });
    expect(findings.worstEscalatedBreaches.map((c) => c.ticketId)).toEqual(["1003", "1001"]);
    expect(findings.topAccounts).toEqual([
      { account: "Acme", escalated: 2, breached: 2 },
      { account: "Initech", escalated: 1, breached: 0 },
    ]);
  });

  it("counts dropped and ignored rows per file instead of guessing", () => {
    const files = Object.fromEntries(findings.dataQuality.files.map((f) => [f.file, f]));
    expect(files["Zendesk tickets"]).toMatchObject({ rows: 6, used: 5, dropped: [{ reason: "missing or non-numeric ticket id", count: 1 }] });
    expect(files["Zendesk audits"]!.used).toBe(9);
    expect(files["Zendesk audits"]!.dropped).toEqual(
      expect.arrayContaining([
        { reason: "ticket not in tickets export", count: 1 },
        { reason: "not a status change (ignored)", count: 1 },
      ]),
    );
    expect(files["Jira changelog"]).toMatchObject({ rows: 6, used: 5 });
    expect(findings.dataQuality.assumedJiraStatuses.map((s) => s.name)).toEqual(["Done", "In Progress", "To Do"]);
  });
});

describe("concierge analysis options", () => {
  it("drops statuses with no known category, and says which", () => {
    const findings = analyze(["--zendesk-subdomain", "acme"]);
    expect(findings.dataQuality.unknownJiraStatuses).toEqual([{ name: "QA Review", rows: 2 }]);
    expect(byTicket(findings, "1004").jiraKeys).toEqual([]);
    expect(findings.coverage.ticketReferencesIssueNotInExport).toBe(1);
  });

  it("won't accept Zendesk URLs without a subdomain to check them against", () => {
    const findings = analyze(["--jira-status", "QA Review=indeterminate"]);
    expect(byTicket(findings, "1003").jiraKeys).toEqual([]);
    expect(findings.coverage.issuesUrlWithoutSubdomain).toBe(2);
    expect(findings.coverage.issuesLinked).toBe(2);
  });

  it("counts only business hours when given", () => {
    // 2026-09-03 is a Thursday: Thu 12:00–17:00 + Fri 09:00–17:00 = 13h of 24h.
    const findings = analyze([
      "--zendesk-subdomain", "acme",
      "--jira-status", "QA Review=indeterminate",
      "--business-hours", "mon-fri 09:00-17:00",
    ]);
    expect(byTicket(findings, "1003").status).toBe("at_risk");
  });

  it("evaluates an optional engineering-leg target", () => {
    const findings = analyze(["--zendesk-subdomain", "acme", "--jira-status", "QA Review=indeterminate", "--engineering-target", "16h"]);
    expect(findings.engineeringTarget).toEqual({ breached: 2, atRisk: 0 });
    expect(byTicket(findings, "1004").engineering).toMatchObject({ status: "met", elapsedMinutes: 60 });
  });

  it("leaves tickets without a matching priority target unevaluated", () => {
    const findings = analyze(["--resolution", "urgent=4h"]);
    expect(findings.ticketsWithoutTarget).toBe(3);
    expect(byTicket(findings, "1001").status).toBe("breached");
  });
});

describe("parsers", () => {
  it("maps Zendesk UI status names like On-hold", () => {
    const tickets = parseCsv("Id,Created at,Status\n1,2026-09-01T09:00:00Z,On-hold\n2,2026-09-01T09:00:00Z,Deleted\n");
    const audits = parseCsv("Ticket ID,Created at,Previous value,Value\n1,2026-09-01T10:00:00Z,On-hold,Weird\n");
    const result = parseZendeskExport(tickets, audits, "UTC");
    expect(result.cases.get("1")!.events[0]!.toState).toBe("pending_internal");
    expect(result.ticketDrops.byReason.get("deleted ticket")).toBe(1);
    expect(result.auditDrops.byReason.get('unknown status "Weird"')).toBe(1);
  });

  it("prefers --jira-status over export categories over stock names", () => {
    const issues = parseCsv("Key,Created,Status,Status Category\nAB-1,2026-09-01T09:00:00Z,Done,In Progress\n");
    const changelog = parseCsv("Key,Created,From,To\n");
    expect(parseJiraExport(issues, changelog, "UTC").statusCategories.get("done")).toMatchObject({ category: "indeterminate", source: "export" });
    expect(
      parseJiraExport(issues, changelog, "UTC", parseStatusOverrides("Done=done")).statusCategories.get("done"),
    ).toMatchObject({ category: "done", source: "flag" });
  });

  it("builds per-priority policies the core matcher ranks above the default", () => {
    const versions = buildPolicyVersions(parseResolutionTargets("urgent=4h, default=1d"));
    expect(versions.map((v) => v.match)).toEqual([{ priority: ["urgent"] }, {}]);
    expect(() => parseResolutionTargets("urgent=4h,urgent=2h")).toThrow(/twice/);
    expect(() => parseResolutionTargets("urgent=soon")).toThrow(/Can't read/);
  });
});

describe("cli output", () => {
  const dir = mkdtempSync(join(tmpdir(), "concierge-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("renders Markdown by default", () => {
    const { output } = run([...baseArgs, "--zendesk-subdomain", "acme", "--jira-status", "QA Review=indeterminate"]);
    expect(output).toContain("**3** tickets were escalated to Jira. **2** of them exceeded their resolution target.");
    expect(output).toContain("Linked 3 of 4 Jira issues that reference a Zendesk ticket (75%).");
    expect(output).toContain("[#1003](https://acme.zendesk.com/agent/tickets/1003)");
    expect(output).toContain("1 issue points at tickets");
  });

  it("writes escaped HTML, owner-readable only, picking the format from the extension", () => {
    const out = join(dir, "findings.html");
    run([...baseArgs, "--company", "<Acme & Co>", "--out", out]);
    const html = readFileSync(out, "utf8");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Escalation findings: &#60;Acme &#38; Co&#62;");
    expect(html).not.toContain("<Acme");
    // Self-contained: the report carries customer data, so it loads nothing remote.
    expect(html).not.toMatch(/https?:\/\/(?!acme\.zendesk\.com)[^"' )]*\.(?:js|css)|<script src|<link /);
    for (const section of ["Link coverage", "Who held the ticket when the target passed", "How this was calculated", "Data sources"]) {
      expect(html).toContain(section);
    }
    expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it("rejects missing inputs with a usage error", () => {
    expect(() => run(["--resolution", "4h"])).toThrow(UsageError);
    expect(() => run([...baseArgs, "--format", "pdf"])).toThrow(/md, html or json/);
  });
});
