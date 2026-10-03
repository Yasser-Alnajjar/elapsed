import {
  formatJqlDateTime,
  type JiraChangelogHistory,
  type JiraClient,
  type JiraIssue,
  type JiraRemoteLink,
  type JiraStatus,
} from "@sla/jira";
import { buildCsv } from "@sla/core";
import type { JiraConciergeExportMetadata } from "./types/concierge-export";
import { createZip } from "./zip";

/**
 * Jira half of a Concierge dataset (`apps/concierge`), pulled live through
 * the organization's connected integration instead of asking a prospect for
 * CSVs. Writes the exact column layout `apps/concierge/src/jira.ts` reads
 * (`ISSUE_COLUMNS`, `CHANGELOG_COLUMNS`), so the files go straight into
 * `--jira-issues` / `--jira-changelog`.
 *
 * Status history comes only from the issue changelog API: one row per
 * `status` item of a changelog history. Nothing is inferred from an issue's
 * current status, `updated`, resolution date or status-category-changed date.
 */

export const JIRA_ISSUES_FILE = "jira-issues.csv";
export const JIRA_CHANGELOG_FILE = "jira-changelog.csv";
export const JIRA_METADATA_FILE = "metadata.json";
export const JIRA_EXPORT_ZIP_FILE = "jira-concierge-export.zip";

export type JiraExportClient = Pick<JiraClient, "searchIssues" | "fetchChangelogPage" | "fetchRemoteLinks" | "fetchStatuses">;

export interface JiraIssueExport {
  issue: JiraIssue;
  histories: JiraChangelogHistory[];
  remoteLinks: JiraRemoteLink[];
}

export interface CollectedJiraExport {
  jql: string;
  statuses: JiraStatus[];
  issues: JiraIssueExport[];
}

export function buildExportJql(sinceDays: number, now: Date = new Date()): string {
  const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);
  return `updated >= "${formatJqlDateTime(since)}" ORDER BY created ASC`;
}

/** Walks every search page and, per issue, every changelog page. */
export async function collectJiraExport(
  client: JiraExportClient,
  options: { sinceDays: number; now?: Date },
): Promise<CollectedJiraExport> {
  const jql = buildExportJql(options.sinceDays, options.now);
  const statuses = await client.fetchStatuses();
  const issues: JiraIssueExport[] = [];
  const seen = new Set<string>();

  let nextPageToken: string | undefined;
  for (;;) {
    const page = await client.searchIssues(jql, nextPageToken);
    for (const issue of page.issues) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      issues.push({
        issue,
        histories: await fetchAllChangelog(client, issue.key),
        remoteLinks: await client.fetchRemoteLinks(issue.key),
      });
    }
    nextPageToken = page.nextPageToken;
    if (page.isLast || !nextPageToken) break;
  }

  return { jql, statuses, issues };
}

async function fetchAllChangelog(client: JiraExportClient, issueKey: string): Promise<JiraChangelogHistory[]> {
  const histories: JiraChangelogHistory[] = [];
  let startAt = 0;
  // Same termination rule as runJiraBackfill's changelog walk.
  for (;;) {
    const page = await client.fetchChangelogPage(issueKey, startAt);
    histories.push(...page.values);
    startAt += page.values.length;
    if (page.isLast || page.values.length === 0) break;
  }
  return histories;
}

/** Jira returns `+0000`-style offsets; Concierge (and Date.parse everywhere) wants a plain UTC ISO string. */
export function toIsoUtc(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

export function issuesToCsv(collected: CollectedJiraExport): string {
  const categoryById = statusCategoryLookup(collected.statuses);
  const linkColumns = Math.max(1, ...collected.issues.map(({ remoteLinks }) => remoteLinks.length));
  const header = [
    "Issue key",
    "Issue id",
    "Summary",
    "Status",
    "Status Category",
    "Priority",
    "Project",
    "Created",
    "Updated",
    "Reporter",
    "Assignee",
    ...Array.from({ length: linkColumns }, () => "Remote Link"),
  ];
  const rows = collected.issues.map(({ issue, remoteLinks }) => {
    const { fields } = issue;
    const links = remoteLinks.map((link) => link.object?.url ?? "");
    return [
      issue.key,
      issue.id,
      fields.summary ?? "",
      fields.status?.name ?? "",
      fields.status?.statusCategory?.key ?? categoryById.get(fields.status?.id ?? "") ?? "",
      fields.priority?.name ?? "",
      fields.project?.key ?? "",
      toIsoUtc(fields.created),
      toIsoUtc(fields.updated),
      fields.reporter?.accountId ?? "",
      fields.assignee?.accountId ?? "",
      ...Array.from({ length: linkColumns }, (_, index) => links[index] ?? ""),
    ];
  });
  return buildCsv(header, rows);
}

export interface ChangelogRow {
  issueKey: string;
  historyId: string;
  created: string;
  fromStatus: string;
  toStatus: string;
  fromCategory: string;
  toCategory: string;
  author: string;
}

/** One row per status item in the changelog, oldest first within each issue. */
export function changelogRows(collected: CollectedJiraExport): ChangelogRow[] {
  const categoryById = statusCategoryLookup(collected.statuses);
  const nameById = new Map(collected.statuses.map((status) => [status.id, status.name]));
  const rows: ChangelogRow[] = [];
  for (const { issue, histories } of collected.issues) {
    const ordered = [...histories].sort((a, b) => {
      const byTime = Date.parse(toIsoUtc(a.created)) - Date.parse(toIsoUtc(b.created));
      return byTime !== 0 ? byTime : Number(a.id) - Number(b.id);
    });
    for (const history of ordered) {
      for (const item of history.items) {
        if (item.field !== "status") continue;
        rows.push({
          issueKey: issue.key,
          historyId: history.id,
          created: toIsoUtc(history.created),
          fromStatus: item.fromString ?? nameById.get(item.from ?? "") ?? "",
          toStatus: item.toString ?? nameById.get(item.to ?? "") ?? "",
          fromCategory: categoryById.get(item.from ?? "") ?? "",
          toCategory: categoryById.get(item.to ?? "") ?? "",
          author: history.author?.accountId ?? "",
        });
      }
    }
  }
  return rows;
}

export function changelogToCsv(rows: ChangelogRow[]): string {
  return buildCsv(
    [
      "Issue key",
      "History id",
      "Created",
      "Field",
      "From status",
      "To status",
      "From status category",
      "To status category",
      "Author",
    ],
    rows.map((row) => [
      row.issueKey,
      row.historyId,
      row.created,
      "status",
      row.fromStatus,
      row.toStatus,
      row.fromCategory,
      row.toCategory,
      row.author,
    ]),
  );
}

function statusCategoryLookup(statuses: JiraStatus[]): Map<string, string> {
  return new Map(statuses.map((status) => [status.id, status.statusCategory?.key ?? ""]));
}

export interface JiraConciergeExportFiles {
  issuesCsv: string;
  changelogCsv: string;
  metadata: JiraConciergeExportMetadata;
  zip: Uint8Array;
}

export function buildJiraConciergeExport(
  collected: CollectedJiraExport,
  context: { organizationId: string; jiraIntegrationId: string; siteUrl: string; sinceDays: number; exportedAt?: Date },
): JiraConciergeExportFiles {
  const issuesCsv = issuesToCsv(collected);
  const rows = changelogRows(collected);
  const changelogCsv = changelogToCsv(rows);
  const metadata: JiraConciergeExportMetadata = {
    format: "jira-concierge-export",
    version: 1,
    exportedAt: (context.exportedAt ?? new Date()).toISOString(),
    organizationId: context.organizationId,
    jiraIntegrationId: context.jiraIntegrationId,
    siteUrl: context.siteUrl,
    jql: collected.jql,
    sinceDays: context.sinceDays,
    issueCount: collected.issues.length,
    changelogEntryCount: rows.length,
    statusCount: collected.statuses.length,
    files: [JIRA_ISSUES_FILE, JIRA_CHANGELOG_FILE, JIRA_METADATA_FILE],
  };
  const encoder = new TextEncoder();
  const zip = createZip(
    [
      { name: JIRA_ISSUES_FILE, data: encoder.encode(issuesCsv) },
      { name: JIRA_CHANGELOG_FILE, data: encoder.encode(changelogCsv) },
      { name: JIRA_METADATA_FILE, data: encoder.encode(JSON.stringify(metadata, null, 2) + "\n") },
    ],
    context.exportedAt,
  );
  return { issuesCsv, changelogCsv, metadata, zip };
}
