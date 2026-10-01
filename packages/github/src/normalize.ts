import type { PrismaClient } from "@sla/db";
import type { CanonicalBatch, EventGroup, ProjectionFailure } from "@sla/ingestion";
import type { Actor, NormalizedState } from "@sla/core";
import type { GithubActor, GithubPullRequest, GithubTimelineItem, GithubTimelineItemType } from "./types";
import { GITHUB_SOURCE_ROLE } from "./source-role";

/**
 * GitHub's PR timeline events, mapped onto `NormalizedState`. Unlike Jira
 * (a separate site-wide status lookup) or even Linear (a per-team,
 * per-workflow `type`), GitHub's PR lifecycle is a small, fixed,
 * un-configurable vocabulary already returned inline on every timeline
 * item — no lookup call is ever needed to recover it.
 */
const TIMELINE_TYPE_TO_STATE: Record<GithubTimelineItemType, NormalizedState> = {
  ReadyForReviewEvent: "in_progress",
  ReviewRequestedEvent: "in_progress",
  PullRequestReview: "in_progress",
  MergedEvent: "resolved",
  ClosedEvent: "closed",
  ReopenedEvent: "open",
};

export class UnknownGithubTimelineItemTypeError extends Error {
  constructor(type: string) {
    super(`Unknown GitHub PR timeline item type: ${type}`);
    this.name = "UnknownGithubTimelineItemTypeError";
  }
}

export function normalizeGithubTimelineItemType(type: string): NormalizedState {
  const mapped = TIMELINE_TYPE_TO_STATE[type as GithubTimelineItemType];
  if (!mapped) throw new UnknownGithubTimelineItemTypeError(type);
  return mapped;
}

/**
 * GitHub PR participants are engineers, never the customer who filed the
 * originating Zendesk ticket — unlike Jira/Linear's "author === reporter ->
 * customer" heuristic, a GitHub actor is either absent (an automation
 * acting without impersonating a user) or an agent. Never "customer": a
 * customer has no route to appear as the actor on a GitHub PR event.
 */
export function resolveGithubActor(actor: GithubActor | null | undefined): Actor {
  if (!actor) return "system";
  return "agent";
}

export interface TimelineRecord {
  /** The RawEvent row id this item was read from — becomes NormalizedEvent.sourceRawEventId. */
  rawEventId: string;
  item: GithubTimelineItem;
}

export function sortTimelineChronologically(records: TimelineRecord[]): TimelineRecord[] {
  return [...records].sort((a, b) => {
    const byTime = Date.parse(a.item.createdAt) - Date.parse(b.item.createdAt);
    return byTime !== 0 ? byTime : a.item.id.localeCompare(b.item.id);
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
 * `RawEvent` → `NormalizedEvent` for one GitHub pull request. Always emits
 * plain `state_changed` events, never `case_created`/`case_closed` — those
 * types mark the anchor Case's own lifecycle (the Zendesk ticket), and a
 * GitHub PR is never the anchor, only ever a linked engineering leg (same
 * as Jira/Linear). Regenerated from scratch on every run.
 *
 * The PR's own creation is synthesized as the first event (`open`, from the
 * `pull_request` snapshot itself, mirroring Jira/Linear's "issue opened"
 * initial transition); each subsequent timeline item chains from the
 * previous event's `toState`.
 */
export function deriveNormalizedEventsForPullRequest(
  pr: GithubPullRequest,
  timelineForPullRequest: TimelineRecord[],
  pullRequestRawEventId: string,
): DerivedNormalizedEvent[] {
  const sorted = sortTimelineChronologically(timelineForPullRequest);

  const events: DerivedNormalizedEvent[] = [
    {
      occurredAt: pr.createdAt,
      actor: resolveGithubActor(pr.author),
      fromState: null,
      toState: "open",
      sourceRawEventId: pullRequestRawEventId,
    },
  ];

  let previousState: NormalizedState = "open";
  for (const { rawEventId, item } of sorted) {
    const toState = normalizeGithubTimelineItemType(item.__typename);
    events.push({
      occurredAt: item.createdAt,
      actor: resolveGithubActor(item.actor),
      fromState: previousState,
      toState,
      sourceRawEventId: rawEventId,
    });
    previousState = toState;
  }

  return events;
}

/** Latest snapshot per PR node id, from `pull_request:{owner}/{repo}#{number}:{hash}` RawEvents. */
function latestPullRequestSnapshots(
  rows: { id: string; payload: unknown; fetchedAt: Date }[],
): Map<string, { rawEventId: string; value: GithubPullRequest; fetchedAt: Date }> {
  const byId = new Map<string, { rawEventId: string; value: GithubPullRequest; fetchedAt: Date }>();
  for (const row of rows) {
    const value = row.payload as GithubPullRequest;
    const existing = byId.get(value.id);
    if (!existing || row.fetchedAt >= existing.fetchedAt) {
      byId.set(value.id, { rawEventId: row.id, value, fetchedAt: row.fetchedAt });
    }
  }
  return byId;
}

/** `pr_timeline:{owner}/{repo}#{number}:{itemId}` — groups by the PR's `owner/repo#number` external id. */
function groupTimelineByPullRequestKey(
  rows: { id: string; providerEventId: string; payload: unknown }[],
): Map<string, TimelineRecord[]> {
  const byKey = new Map<string, TimelineRecord[]>();
  for (const row of rows) {
    const key = row.providerEventId.split(":")[1];
    if (!key) continue;
    const record: TimelineRecord = { rawEventId: row.id, item: row.payload as GithubTimelineItem };
    const group = byKey.get(key);
    if (group) group.push(record);
    else byKey.set(key, [record]);
  }
  return byKey;
}

/**
 * Derives the events of every GitHub pull request linked to a Case (via a
 * `certain` CaseLink — the correlator's job, run before this), aimed at that
 * case. The shared projector reconciles them, scoped to each PR's own
 * RawEvents, mirroring Jira's and Linear's builders. Writes nothing.
 *
 * A PR with no `certain` CaseLink yet is skipped, not an error — most GitHub
 * pull requests are internal engineering work with no customer-facing case
 * to attach to, and correlation coverage is expected to be partial.
 */
export async function buildGithubBatch(prisma: PrismaClient, integrationId: string): Promise<CanonicalBatch> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const organizationId = integration.organizationId;
  const { owner, repo } = integration.credentials as unknown as { owner: string; repo: string };

  const [pullRequestRows, timelineRows, caseLinks] = await Promise.all([
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "pull_request:" } },
      select: { id: true, payload: true, fetchedAt: true },
      orderBy: { fetchedAt: "asc" },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "pr_timeline:" } },
      select: { id: true, providerEventId: true, payload: true },
    }),
    prisma.caseLink.findMany({
      where: { system: "github", confidence: "certain", case: { organizationId } },
      select: { caseId: true, externalId: true },
    }),
  ]);

  const latestPullRequests = latestPullRequestSnapshots(pullRequestRows);
  const timelineByKey = groupTimelineByPullRequestKey(timelineRows);
  const caseIdByExternalId = new Map(caseLinks.map((link) => [link.externalId, link.caseId]));

  const eventGroups: EventGroup[] = [];
  const failures: ProjectionFailure[] = [];

  for (const { rawEventId: pullRequestRawEventId, value: pr } of latestPullRequests.values()) {
    const externalId = `${owner}/${repo}#${pr.number}`;
    const caseId = caseIdByExternalId.get(externalId);
    if (!caseId) continue;

    try {
      const derived = deriveNormalizedEventsForPullRequest(pr, timelineByKey.get(externalId) ?? [], pullRequestRawEventId);

      const ownRawEvents = await prisma.rawEvent.findMany({
        where: {
          integrationId,
          OR: [
            { providerEventId: { startsWith: `pull_request:${externalId}:` } },
            { providerEventId: { startsWith: `pr_timeline:${externalId}:` } },
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
          sourceRole: GITHUB_SOURCE_ROLE,
          fromState: event.fromState,
          toState: event.toState,
          sourceRawEventId: event.sourceRawEventId,
          sourceSequence,
        })),
        recordId: externalId,
      });
    } catch (error) {
      failures.push({ id: externalId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { customers: [], cases: [], eventGroups, deletedCaseExternalIds: [], failures };
}
