import type { JiraChangelogHistory, JiraIssue, JiraSearchPage, JiraStatus } from "@sla/jira";
import { describe, expect, it } from "vitest";
// The files are only useful if Concierge reads them, so they're parsed with its own reader.
import { parseCsv } from "../../concierge/src/csv";
import { parseJiraExport } from "../../concierge/src/jira";
import {
  buildExportJql,
  buildJiraConciergeExport,
  changelogRows,
  collectJiraExport,
  toIsoUtc,
  type JiraExportClient,
} from "@/lib/jira-concierge-export";
import { buildCsv } from "@sla/core";
import { readStoredZip } from "@/lib/zip";

const STATUSES: JiraStatus[] = [
  { id: "1", name: "To Do", statusCategory: { key: "new", name: "To Do" } },
  { id: "2", name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress" } },
  { id: "5", name: "QA Review", statusCategory: { key: "indeterminate", name: "In Progress" } },
  { id: "3", name: "Done", statusCategory: { key: "done", name: "Done" } },
];

function issue(key: string, overrides: Partial<JiraIssue["fields"]> = {}): JiraIssue {
  return {
    id: key.replace(/\D/g, ""),
    key,
    self: "",
    fields: {
      summary: `Summary ${key}`,
      status: { id: "1", name: "To Do", statusCategory: { key: "new" } },
      priority: { id: "2", name: "High" },
      project: { id: "100", key: "SUP", name: "Support" },
      created: "2026-09-01T10:00:00.000+0000",
      updated: "2026-09-03T10:00:00.000+0000",
      reporter: { accountId: "rep-1" },
      assignee: null,
      ...overrides,
    },
  };
}

function statusHistory(id: string, created: string, from: [string, string], to: [string, string]): JiraChangelogHistory {
  return {
    id,
    author: { accountId: "eng-1" },
    created,
    items: [{ field: "status", fieldtype: "jira", from: from[0], fromString: from[1], to: to[0], toString: to[1] }],
  };
}

/** Records calls; issues span two search pages, SUP-1's changelog spans two pages. */
function fakeClient() {
  const calls = { search: [] as (string | undefined)[], changelog: [] as [string, number][] };
  const searchPages: Record<string, JiraSearchPage> = {
    first: {
      isLast: false,
      nextPageToken: "page-2",
      issues: [
        issue("SUP-1", { status: { id: "3", name: "Done" }, summary: 'Card "declined", on checkout\nline two' }),
        issue("SUP-2", { status: { id: "5", name: "QA Review" } }),
      ],
    },
    "page-2": { isLast: true, issues: [issue("SUP-3"), issue("SUP-2")] },
  };
  const changelogs: Record<string, JiraChangelogHistory[]> = {
    "SUP-1": [
      statusHistory("10", "2026-09-01T11:00:00.000+0000", ["1", "To Do"], ["2", "In Progress"]),
      { id: "11", author: { accountId: "eng-1" }, created: "2026-09-01T11:30:00.000+0000", items: [{ field: "assignee", fieldtype: "jira", from: null, fromString: null, to: "eng-1", toString: "Eng" }] },
      statusHistory("12", "2026-09-02T08:00:00.000+0000", ["2", "In Progress"], ["3", "Done"]),
    ],
    "SUP-2": [
      statusHistory("21", "2026-09-03T14:00:00.000+0200", ["1", "To Do"], ["2", "In Progress"]),
      statusHistory("20", "2026-09-03T11:00:00.000+0000", ["2", "In Progress"], ["5", "QA Review"]),
    ],
  };
  const client: JiraExportClient = {
    fetchStatuses: async () => STATUSES,
    searchIssues: async (_jql, token) => {
      calls.search.push(token);
      return searchPages[token ?? "first"]!;
    },
    fetchChangelogPage: async (key, startAt = 0) => {
      calls.changelog.push([key, startAt]);
      const all = changelogs[key] ?? [];
      const pageSize = 2;
      const values = all.slice(startAt, startAt + pageSize);
      return { values, startAt, maxResults: pageSize, total: all.length, isLast: startAt + pageSize >= all.length };
    },
    fetchRemoteLinks: async (key) =>
      key === "SUP-1"
        ? [
            { id: 1, self: "", object: { url: "https://acme.zendesk.com/agent/tickets/1001", title: "Ticket 1001" } },
            { id: 2, self: "", object: { url: "https://wiki.acme.test/a,b", title: "Runbook" } },
          ]
        : [],
  };
  return { client, calls };
}

describe("collectJiraExport", () => {
  it("follows search and changelog pagination, deduplicating issues", async () => {
    const { client, calls } = fakeClient();
    const collected = await collectJiraExport(client, { sinceDays: 30 });
    expect(calls.search).toEqual([undefined, "page-2"]);
    expect(collected.issues.map(({ issue }) => issue.key)).toEqual(["SUP-1", "SUP-2", "SUP-3"]);
    expect(calls.changelog).toEqual([
      ["SUP-1", 0],
      ["SUP-1", 2],
      ["SUP-2", 0],
      ["SUP-3", 0],
    ]);
    expect(collected.issues[0]!.histories.map((h) => h.id)).toEqual(["10", "11", "12"]);
  });

  it("windows the search on updated date", () => {
    expect(buildExportJql(2, new Date("2026-09-17T12:30:00Z"))).toBe('updated >= "2026/09/15 12:30" ORDER BY created ASC');
  });
});

describe("changelog rows", () => {
  it("are the changelog's status transitions only, in time order, with categories", async () => {
    const collected = await collectJiraExport(fakeClient().client, { sinceDays: 30 });
    expect(changelogRows(collected)).toEqual([
      { issueKey: "SUP-1", historyId: "10", created: "2026-09-01T11:00:00.000Z", fromStatus: "To Do", toStatus: "In Progress", fromCategory: "new", toCategory: "indeterminate", author: "eng-1" },
      { issueKey: "SUP-1", historyId: "12", created: "2026-09-02T08:00:00.000Z", fromStatus: "In Progress", toStatus: "Done", fromCategory: "indeterminate", toCategory: "done", author: "eng-1" },
      // 14:00+02:00 is 12:00Z, after history 20 at 11:00Z.
      { issueKey: "SUP-2", historyId: "20", created: "2026-09-03T11:00:00.000Z", fromStatus: "In Progress", toStatus: "QA Review", fromCategory: "indeterminate", toCategory: "indeterminate", author: "eng-1" },
      { issueKey: "SUP-2", historyId: "21", created: "2026-09-03T12:00:00.000Z", fromStatus: "To Do", toStatus: "In Progress", fromCategory: "new", toCategory: "indeterminate", author: "eng-1" },
    ]);
  });

  it("aren't invented for an issue without changelog history", async () => {
    const collected = await collectJiraExport(fakeClient().client, { sinceDays: 30 });
    expect(changelogRows(collected).some((row) => row.issueKey === "SUP-3")).toBe(false);
  });
});

describe("export files", () => {
  it("escape CSV fields and round-trip through Concierge's parser", async () => {
    const collected = await collectJiraExport(fakeClient().client, { sinceDays: 30 });
    const files = buildJiraConciergeExport(collected, {
      organizationId: "org-a",
      jiraIntegrationId: "jira-a",
      siteUrl: "https://acme.atlassian.net",
      sinceDays: 30,
      exportedAt: new Date("2026-09-17T00:00:00Z"),
    });

    const issues = parseCsv(files.issuesCsv);
    expect(issues.header).toEqual([
      "Issue key", "Issue id", "Summary", "Status", "Status Category", "Priority", "Project", "Created", "Updated", "Reporter", "Assignee", "Remote Link", "Remote Link",
    ]);
    expect(issues.rows[0]!.slice(0, 5)).toEqual(["SUP-1", "1", 'Card "declined", on checkout\nline two', "Done", "done"]);
    expect(issues.rows[0]!.slice(11)).toEqual(["https://acme.zendesk.com/agent/tickets/1001", "https://wiki.acme.test/a,b"]);
    expect(files.issuesCsv).toContain('"Card ""declined"", on checkout\nline two"');

    const parsed = parseJiraExport(issues, parseCsv(files.changelogCsv), "UTC");
    expect(parsed.issueDrops.total).toBe(0);
    expect(parsed.changelogDrops.total).toBe(0);
    expect(parsed.changelogRowsUsed).toBe(4);
    expect(parsed.unknownStatuses.size).toBe(0);
    // QA Review is a custom status: its category comes from the export, not a guess.
    expect(parsed.statusCategories.get("qa review")).toMatchObject({ category: "indeterminate", source: "export" });
    expect(parsed.issuesWithoutChangelog).toEqual(["SUP-3"]);

    const zip = readStoredZip(files.zip);
    expect([...zip.keys()]).toEqual(["jira-issues.csv", "jira-changelog.csv", "metadata.json"]);
    expect(new TextDecoder().decode(zip.get("jira-issues.csv"))).toBe(files.issuesCsv);
    expect(JSON.parse(new TextDecoder().decode(zip.get("metadata.json")))).toMatchObject({
      organizationId: "org-a",
      jiraIntegrationId: "jira-a",
      issueCount: 3,
      changelogEntryCount: 4,
      exportedAt: "2026-09-17T00:00:00.000Z",
    });
  });

  it("buildCsv quotes commas, quotes, CR and LF, and leaves plain values alone", () => {
    expect(buildCsv(["a", "b"], [["plain", 'x,"y"'], ["cr\rhere", null]])).toBe('a,b\r\nplain,"x,""y"""\r\n"cr\rhere",\r\n');
  });

  it("normalizes Jira offsets to UTC", () => {
    expect(toIsoUtc("2026-09-03T14:00:00.000+0200")).toBe("2026-09-03T12:00:00.000Z");
    expect(toIsoUtc(null)).toBe("");
  });
});
