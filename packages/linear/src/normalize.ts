import type { PrismaClient } from "@sla/db";
import type { Actor, NormalizedState } from "@sla/core";
import type { CanonicalBatch, EventGroup, ProjectionFailure } from "@sla/ingestion";
import type { LinearHistoryEntry, LinearIssue, LinearWorkflowState } from "./types";
import { LINEAR_SOURCE_ROLE } from "./source-role";

/**
 * Linear's true fixed vocabulary (`LinearWorkflowState.type`), unlike the
 * per-team, per-workflow state name itself. Six categories map onto
 * `NormalizedState`'s eight values with `backlog`/`unstarted` collapsing to
 * the same pre-start `open` — both mean "accepted, not yet in progress,"
 * and `NormalizedState` has no finer distinction than that.
 */
const TYPE_TO_NORMALIZED_STATE: Record<string, NormalizedState> = {
  triage: "new",
  backlog: "open",
  unstarted: "open",
  started: "in_progress",
  completed: "resolved",
  canceled: "closed",
};

export class UnknownLinearStateTypeError extends Error {
  constructor(type: string) {
    super(`Unknown Linear workflow state type: ${type}`);
    this.name = "UnknownLinearStateTypeError";
  }
}

export function normalizeLinearStateType(type: string): NormalizedState {
  const mapped = TYPE_TO_NORMALIZED_STATE[type];
  if (!mapped) throw new UnknownLinearStateTypeError(type);
  return mapped;
}

/**
 * Best-effort actor resolution, mirroring Jira's `resolveJiraActor`: a null
 * actor (an automation rule acting without impersonating a user) is
 * "system"; otherwise compare to the issue's creator, defaulting to "agent"
 * since most transitions on a support-linked engineering issue are
 * engineer-side.
 */
export function resolveLinearActor(
  actor: { id: string; name: string } | null | undefined,
  issue: LinearIssue,
): Actor {
  if (!actor) return "system";
  if (issue.creator?.id === actor.id) return "customer";
  return "agent";
}

export interface HistoryRecord {
  /** The RawEvent row id this entry was read from — becomes NormalizedEvent.sourceRawEventId. */
  rawEventId: string;
  entry: LinearHistoryEntry;
}

/**
 * When the entry's current state change actually happened. Linear rewrites a
 * coalesced entry in place — `createdAt` stays at the first change while
 * `toState` and `updatedAt` move on — so `createdAt` alone would date a later
 * transition to the moment of the first one. Rows fetched before `updatedAt`
 * was queried fall back to `createdAt`.
 */
export function historyEntryOccurredAt(entry: LinearHistoryEntry): string {
  if (!entry.updatedAt) return entry.createdAt;
  return Date.parse(entry.updatedAt) > Date.parse(entry.createdAt) ? entry.updatedAt : entry.createdAt;
}

export function sortHistoriesChronologically(histories: HistoryRecord[]): HistoryRecord[] {
  return [...histories].sort((a, b) => {
    const byTime = Date.parse(historyEntryOccurredAt(a.entry)) - Date.parse(historyEntryOccurredAt(b.entry));
    return byTime !== 0 ? byTime : a.entry.id.localeCompare(b.entry.id);
  });
}

type StateChangeRecord = HistoryRecord & { entry: { fromState: LinearWorkflowState; toState: LinearWorkflowState } };

function isStateChangeRecord(record: HistoryRecord): record is StateChangeRecord {
  return record.entry.fromState !== null && record.entry.toState !== null;
}

export interface DerivedNormalizedEvent {
  occurredAt: string;
  actor: Actor;
  fromState: NormalizedState | null;
  toState: NormalizedState;
  sourceRawEventId: string;
}

/**
 * `RawEvent` → `NormalizedEvent` for one Linear issue. Always emits plain
 * `state_changed` events, never `case_created`/`case_closed` — those types
 * mark the anchor Case's own lifecycle (the Zendesk ticket), and a Linear
 * issue is never the anchor, only ever a linked engineering leg. Regenerated
 * from scratch on every run, mirroring Jira's normalizer (roadmap step 5).
 *
 * The issue's initial state comes from the first state-changing history
 * entry's `fromState` (falling back to the issue's current state when no
 * state change was ever recorded) — same approach as Jira's changelog `from`.
 * Unlike Jira, Linear's history embeds the full state object (including
 * `type`) directly on every entry, so no separate site-wide status lookup is
 * needed to recover the fixed-vocabulary category.
 */
export function deriveNormalizedEventsForIssue(
  issue: LinearIssue,
  historiesForIssue: HistoryRecord[],
  issueRawEventId: string,
): DerivedNormalizedEvent[] {
  const sorted = sortHistoriesChronologically(historiesForIssue);
  const stateChanges = sorted.filter(isStateChangeRecord);

  const firstChange = stateChanges[0];
  const initialState = firstChange ? firstChange.entry.fromState : issue.state;
  const createdActor = firstChange
    ? resolveLinearActor(firstChange.entry.actor, issue)
    : resolveLinearActor(issue.creator, issue);

  const events: DerivedNormalizedEvent[] = [
    {
      occurredAt: issue.createdAt,
      actor: createdActor,
      fromState: null,
      toState: normalizeLinearStateType(initialState.type),
      sourceRawEventId: firstChange?.rawEventId ?? issueRawEventId,
    },
  ];

  for (const { rawEventId, entry } of stateChanges) {
    events.push({
      occurredAt: historyEntryOccurredAt(entry),
      actor: resolveLinearActor(entry.actor, issue),
      fromState: normalizeLinearStateType(entry.fromState.type),
      toState: normalizeLinearStateType(entry.toState.type),
      sourceRawEventId: rawEventId,
    });
  }

  return events;
}

function latestIssueSnapshots(
  rows: { id: string; payload: unknown; fetchedAt: Date }[],
): Map<string, { rawEventId: string; value: LinearIssue; fetchedAt: Date }> {
  const byId = new Map<string, { rawEventId: string; value: LinearIssue; fetchedAt: Date }>();
  for (const row of rows) {
    const value = row.payload as LinearIssue;
    const existing = byId.get(value.id);
    if (!existing || row.fetchedAt >= existing.fetchedAt) {
      byId.set(value.id, { rawEventId: row.id, value, fetchedAt: row.fetchedAt });
    }
  }
  return byId;
}

/**
 * Whether `candidate` is a later version of the same history entry than
 * `existing`. Ranked by the entry's own `updatedAt`, not `fetchedAt`: Linear
 * advances `updatedAt` on every in-place rewrite, whereas `fetchedAt` only
 * orders first sightings. Rows with no `updatedAt` (fetched before it was
 * queried) rank below any row that has one and tie among themselves on
 * `fetchedAt`.
 */
function isNewerHistoryVersion(
  candidate: { record: HistoryRecord; fetchedAt: Date },
  existing: { record: HistoryRecord; fetchedAt: Date },
): boolean {
  const candidateUpdated = candidate.record.entry.updatedAt ? Date.parse(candidate.record.entry.updatedAt) : -Infinity;
  const existingUpdated = existing.record.entry.updatedAt ? Date.parse(existing.record.entry.updatedAt) : -Infinity;
  if (candidateUpdated !== existingUpdated) return candidateUpdated > existingUpdated;
  return candidate.fetchedAt >= existing.fetchedAt;
}

/**
 * `issue_history:{issueId}:{entryId}:{hash}` — history entries carry no issue
 * id of their own. An entry can be rewritten in place by Linear, so the same
 * entry id may have several RawEvents; only the newest version of each is
 * kept. (Rows written before the hash was added have no hash segment and are
 * superseded the same way.)
 */
function groupHistoriesByIssueId(
  rows: { id: string; providerEventId: string; payload: unknown; fetchedAt: Date }[],
): Map<string, HistoryRecord[]> {
  const latestByEntry = new Map<string, { issueId: string; record: HistoryRecord; fetchedAt: Date }>();
  for (const row of rows) {
    const [, issueId, entryId] = row.providerEventId.split(":");
    if (!issueId || !entryId) continue;
    const key = `${issueId}:${entryId}`;
    const candidate = {
      issueId,
      record: { rawEventId: row.id, entry: row.payload as LinearHistoryEntry },
      fetchedAt: row.fetchedAt,
    };
    const existing = latestByEntry.get(key);
    if (existing && !isNewerHistoryVersion(candidate, existing)) continue;
    latestByEntry.set(key, candidate);
  }

  const byIssueId = new Map<string, HistoryRecord[]>();
  for (const { issueId, record } of latestByEntry.values()) {
    const group = byIssueId.get(issueId);
    if (group) group.push(record);
    else byIssueId.set(issueId, [record]);
  }
  return byIssueId;
}

/**
 * Derives the events of every Linear issue linked to a Case (via a `certain`
 * CaseLink — the correlator's job, run before this), aimed at that case. The
 * shared projector reconciles them; each issue's group is scoped to that
 * issue's own RawEvents only, so another provider's events on the same case
 * are never touched. Writes nothing.
 *
 * An issue with no `certain` CaseLink yet is skipped, not an error — most
 * Linear issues are internal engineering work with no customer-facing case
 * to attach to, and correlation coverage is expected to be partial (Phase 15).
 */
export async function buildLinearBatch(prisma: PrismaClient, integrationId: string): Promise<CanonicalBatch> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const organizationId = integration.organizationId;

  const [issueRows, historyRows, caseLinks] = await Promise.all([
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "issue:" } },
      select: { id: true, payload: true, fetchedAt: true },
      orderBy: { fetchedAt: "asc" },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "issue_history:" } },
      select: { id: true, providerEventId: true, payload: true, fetchedAt: true },
    }),
    prisma.caseLink.findMany({
      where: { system: "linear", confidence: "certain", case: { organizationId } },
      select: { caseId: true, externalId: true },
    }),
  ]);

  const latestIssues = latestIssueSnapshots(issueRows);
  const historiesByIssueId = groupHistoriesByIssueId(historyRows);
  const caseIdByIdentifier = new Map(caseLinks.map((link) => [link.externalId, link.caseId]));

  const eventGroups: EventGroup[] = [];
  const failures: ProjectionFailure[] = [];

  for (const { rawEventId: issueRawEventId, value: issue } of latestIssues.values()) {
    const caseId = caseIdByIdentifier.get(issue.identifier);
    if (!caseId) continue;

    try {
      const derived = deriveNormalizedEventsForIssue(issue, historiesByIssueId.get(issue.id) ?? [], issueRawEventId);

      const ownRawEvents = await prisma.rawEvent.findMany({
        where: {
          integrationId,
          OR: [
            { providerEventId: { startsWith: `issue:${issue.id}:` } },
            { providerEventId: { startsWith: `issue_history:${issue.id}:` } },
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
          sourceRole: LINEAR_SOURCE_ROLE,
          fromState: event.fromState,
          toState: event.toState,
          sourceRawEventId: event.sourceRawEventId,
          sourceSequence,
        })),
        recordId: issue.identifier,
      });
    } catch (error) {
      failures.push({ id: issue.identifier, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { customers: [], cases: [], eventGroups, deletedCaseExternalIds: [], failures };
}
