import type { PrismaClient } from "@sla/db";
import type { CanonicalBatch, EventGroup, ProjectionFailure } from "@sla/ingestion";
import type { Actor, NormalizedState } from "@sla/core";
import type { JiraChangelogHistory, JiraIssue, JiraStatus } from "./types";
import { JIRA_SOURCE_ROLE } from "./source-role";

/**
 * Jira's true fixed vocabulary — unlike the status itself (per-workflow,
 * per-project, unbounded), every status belongs to exactly one of these
 * three categories.
 */
const CATEGORY_TO_NORMALIZED_STATE: Record<string, NormalizedState> = {
  new: "new",
  indeterminate: "in_progress",
  done: "resolved",
};

export class UnknownJiraStatusCategoryError extends Error {
  constructor(categoryKey: string) {
    super(`Unknown Jira status category: ${categoryKey}`);
    this.name = "UnknownJiraStatusCategoryError";
  }
}

export function normalizeJiraStatusCategory(
  categoryKey: string,
): NormalizedState {
  const mapped = CATEGORY_TO_NORMALIZED_STATE[categoryKey];
  if (!mapped) throw new UnknownJiraStatusCategoryError(categoryKey);
  return mapped;
}

export class UnknownJiraStatusError extends Error {
  constructor(statusId: string) {
    super(
      `Status id ${statusId} is not in the site's status list — cannot normalize`,
    );
    this.name = "UnknownJiraStatusError";
  }
}

/**
 * A changelog entry's `from`/`to` are status ids, not categories — this
 * lookup (built once per run from the site-wide status list) is what makes
 * historical transitions resolvable without guessing from a status name.
 */
export function buildStatusLookup(
  statuses: JiraStatus[],
): Map<string, NormalizedState> {
  const lookup = new Map<string, NormalizedState>();
  for (const status of statuses) {
    lookup.set(
      status.id,
      normalizeJiraStatusCategory(status.statusCategory.key),
    );
  }
  return lookup;
}

function normalizeStatusId(
  statusId: string,
  statusById: Map<string, NormalizedState>,
): NormalizedState {
  const mapped = statusById.get(statusId);
  if (!mapped) throw new UnknownJiraStatusError(statusId);
  return mapped;
}

/**
 * Best-effort actor resolution, mirroring Zendesk's `resolveActor`: Jira's
 * changelog carries no channel signal, so a null author (an automation rule
 * acting without impersonating a user) is "system"; otherwise compare to the
 * issue's reporter, defaulting to "agent" since most transitions on a
 * support-linked engineering issue are engineer-side.
 */
export function resolveJiraActor(
  authorAccountId: string | null | undefined,
  issue: JiraIssue,
): Actor {
  if (!authorAccountId) return "system";
  if (issue.fields.reporter?.accountId === authorAccountId) return "customer";
  return "agent";
}

type StatusChangeItem = JiraChangelogHistory["items"][number] & {
  from: string;
  to: string;
};

function isStatusChangeItem(
  item: JiraChangelogHistory["items"][number],
): item is StatusChangeItem {
  return item.field === "status" && item.from !== null && item.to !== null;
}

export interface ChangelogRecord {
  /** The RawEvent row id this history was read from — becomes NormalizedEvent.sourceRawEventId. */
  rawEventId: string;
  history: JiraChangelogHistory;
}

export function sortHistoriesChronologically(
  histories: ChangelogRecord[],
): ChangelogRecord[] {
  return [...histories].sort((a, b) => {
    const byTime =
      Date.parse(a.history.created) - Date.parse(b.history.created);
    return byTime !== 0 ? byTime : Number(a.history.id) - Number(b.history.id);
  });
}

export interface DerivedNormalizedEvent {
  occurredAt: string;
  actor: Actor;
  fromState: NormalizedState | null;
  toState: NormalizedState;
  sourceRawEventId: string;
}

/**
 * `RawEvent` → `NormalizedEvent` for one Jira issue. Always emits plain
 * `state_changed` events, never `case_created`/`case_closed` — those types
 * mark the anchor Case's own lifecycle (the Zendesk ticket), and a Jira issue
 * is never the anchor, only ever a linked engineering leg. Regenerated from
 * scratch on every run, mirroring the Zendesk normalizer (roadmap step 3).
 *
 * The issue's initial state comes from the first status-change history's
 * `from` id (falling back to the issue's current status when no status
 * change was ever recorded), same approach as Zendesk's `previous_value`.
 */
export function deriveNormalizedEventsForIssue(
  issue: JiraIssue,
  historiesForIssue: ChangelogRecord[],
  issueRawEventId: string,
  statusById: Map<string, NormalizedState>,
): DerivedNormalizedEvent[] {
  const sorted = sortHistoriesChronologically(historiesForIssue);
  const statusChanges = sorted.flatMap(({ rawEventId, history }) =>
    history.items
      .filter(isStatusChangeItem)
      .map((item) => ({ rawEventId, history, item })),
  );

  const firstChange = statusChanges[0];
  const initialStatusId = firstChange
    ? firstChange.item.from
    : issue.fields.status.id;
  const createdActor = firstChange
    ? resolveJiraActor(firstChange.history.author?.accountId, issue)
    : resolveJiraActor(issue.fields.reporter?.accountId, issue);

  const events: DerivedNormalizedEvent[] = [
    {
      occurredAt: issue.fields.created,
      actor: createdActor,
      fromState: null,
      toState: normalizeStatusId(initialStatusId, statusById),
      sourceRawEventId: firstChange?.rawEventId ?? issueRawEventId,
    },
  ];

  for (const { rawEventId, history, item } of statusChanges) {
    events.push({
      occurredAt: history.created,
      actor: resolveJiraActor(history.author?.accountId, issue),
      fromState: normalizeStatusId(item.from, statusById),
      toState: normalizeStatusId(item.to, statusById),
      sourceRawEventId: rawEventId,
    });
  }

  return events;
}

function latestIssueSnapshots(
  rows: { id: string; payload: unknown; fetchedAt: Date }[],
): Map<string, { rawEventId: string; value: JiraIssue; fetchedAt: Date }> {
  const byKey = new Map<
    string,
    { rawEventId: string; value: JiraIssue; fetchedAt: Date }
  >();
  for (const row of rows) {
    const value = row.payload as JiraIssue;
    const existing = byKey.get(value.key);
    if (!existing || row.fetchedAt >= existing.fetchedAt) {
      byKey.set(value.key, {
        rawEventId: row.id,
        value,
        fetchedAt: row.fetchedAt,
      });
    }
  }
  return byKey;
}

function latestStatusSnapshots(
  rows: { payload: unknown; fetchedAt: Date }[],
): JiraStatus[] {
  const byId = new Map<string, { value: JiraStatus; fetchedAt: Date }>();
  for (const row of rows) {
    const value = row.payload as JiraStatus;
    const existing = byId.get(value.id);
    if (!existing || row.fetchedAt >= existing.fetchedAt) {
      byId.set(value.id, { value, fetchedAt: row.fetchedAt });
    }
  }
  return [...byId.values()].map((entry) => entry.value);
}

/** `issue_changelog:{issueKey}:{historyId}` — histories carry no issue key of their own. */
function groupHistoriesByIssueKey(
  rows: { id: string; providerEventId: string; payload: unknown }[],
): Map<string, ChangelogRecord[]> {
  const byIssueKey = new Map<string, ChangelogRecord[]>();
  for (const row of rows) {
    const issueKey = row.providerEventId.split(":")[1];
    if (!issueKey) continue;
    const record: ChangelogRecord = {
      rawEventId: row.id,
      history: row.payload as JiraChangelogHistory,
    };
    const group = byIssueKey.get(issueKey);
    if (group) group.push(record);
    else byIssueKey.set(issueKey, [record]);
  }
  return byIssueKey;
}

export interface JiraNormalizationScope {
  /**
   * Limits the run to these issues' own RawEvents/CaseLinks — used by the
   * webhook receiver so a single issue update doesn't re-derive
   * NormalizedEvents for every issue the integration has ever seen (roadmap
   * task 2.4). The site-wide status list still loads unscoped: it's a small
   * reference table, not the per-issue changelog history that makes an
   * unscoped run expensive. Omit for the worker's full-account cycle, which
   * must still see every issue.
   */
  issueKeys?: string[];
}

/**
 * Derives the events of every Jira issue linked to a Case (via a `certain`
 * CaseLink — the correlator's job, run before this), aimed at that case. The
 * shared projector reconciles them, scoped to each issue's own RawEvents so a
 * case's `issue_linked` event and any other linked issue's events are left
 * alone. Each issue also carries its live status name as a patch to its
 * CaseLink's evidence, written in the same transaction. Writes nothing.
 *
 * An issue with no `certain` CaseLink yet is skipped, not an error — most
 * Jira issues are internal engineering work with no customer-facing case to
 * attach to, and correlation coverage is expected to be partial (Phase 15).
 */
export async function buildJiraBatch(
  prisma: PrismaClient,
  integrationId: string,
  scope: JiraNormalizationScope = {},
): Promise<CanonicalBatch> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  const organizationId = integration.organizationId;
  const { issueKeys } = scope;

  const [issueRows, historyRows, statusRows, caseLinks] = await Promise.all([
    prisma.rawEvent.findMany({
      where: {
        integrationId,
        providerEventId: { startsWith: "issue:" },
        ...(issueKeys ? { OR: issueKeys.map((key) => ({ providerEventId: { startsWith: `issue:${key}:` } })) } : {}),
      },
      select: { id: true, payload: true, fetchedAt: true },
      orderBy: { fetchedAt: "asc" },
    }),
    prisma.rawEvent.findMany({
      where: {
        integrationId,
        providerEventId: { startsWith: "issue_changelog:" },
        ...(issueKeys
          ? { OR: issueKeys.map((key) => ({ providerEventId: { startsWith: `issue_changelog:${key}:` } })) }
          : {}),
      },
      select: { id: true, providerEventId: true, payload: true },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "status:" } },
      select: { payload: true, fetchedAt: true },
    }),
    prisma.caseLink.findMany({
      where: {
        system: "jira",
        confidence: "certain",
        case: { organizationId },
        ...(issueKeys ? { externalId: { in: issueKeys } } : {}),
      },
      select: { caseId: true, externalId: true },
    }),
  ]);

  const statusById = buildStatusLookup(latestStatusSnapshots(statusRows));
  const latestIssues = latestIssueSnapshots(issueRows);
  const historiesByIssueKey = groupHistoriesByIssueKey(historyRows);
  const caseIdByIssueKey = new Map(caseLinks.map((link) => [link.externalId, link.caseId]));

  const eventGroups: EventGroup[] = [];
  const failures: ProjectionFailure[] = [];

  for (const { rawEventId: issueRawEventId, value: issue } of latestIssues.values()) {
    const caseId = caseIdByIssueKey.get(issue.key);
    if (!caseId) continue;

    try {
      const derived = deriveNormalizedEventsForIssue(
        issue,
        historiesByIssueKey.get(issue.key) ?? [],
        issueRawEventId,
        statusById,
      );

      const ownRawEvents = await prisma.rawEvent.findMany({
        where: {
          integrationId,
          OR: [
            { providerEventId: { startsWith: `issue:${issue.key}:` } },
            { providerEventId: { startsWith: `issue_changelog:${issue.key}:` } },
          ],
        },
        select: { id: true },
      });

      eventGroups.push({
        target: { caseId },
        ownRawEventIds: ownRawEvents.map((row) => row.id),
        // `derived` is emitted in source order, so its index is the source sequence.
        events: derived.map((event, sourceSequence) => ({
          type: "state_changed" as const,
          occurredAt: new Date(event.occurredAt),
          actor: event.actor,
          sourceRole: JIRA_SOURCE_ROLE,
          fromState: event.fromState,
          toState: event.toState,
          sourceRawEventId: event.sourceRawEventId,
          sourceSequence,
        })),
        // The timeline carries only the coarse new/in_progress/resolved
        // category; the live name ("In Progress") rides on the link's evidence.
        linkEvidencePatch: { externalId: issue.key, patch: { statusName: issue.fields.status.name } },
        recordId: issue.key,
      });
    } catch (error) {
      failures.push({ id: issue.key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { customers: [], cases: [], eventGroups, deletedCaseExternalIds: [], failures };
}
