import { randomUUID } from "node:crypto";
import { computeSourceHash } from "./hash";
import type { JiraChangelogHistory, JiraIssue, JiraRemoteLink, JiraStatus } from "./types";

/** What gets written to one RawEvent row, minus the integrationId FK. */
export interface RawEventInput {
  providerEventId: string;
  sourceHash: string;
  payload: unknown;
}

/**
 * Issues are mutable snapshots, not events. The hash is folded into the
 * provider event id so an unchanged re-fetch collides with the existing row
 * (skipped via skipDuplicates) while a real change lands as a new, distinct
 * RawEvent — append-only either way.
 */
export function mapIssueToRawEvent(issue: JiraIssue): RawEventInput {
  const sourceHash = computeSourceHash(issue);
  return { providerEventId: `issue:${issue.key}:${sourceHash}`, sourceHash, payload: issue };
}

/**
 * Changelog histories are Jira's immutable event log — each history id
 * occurs exactly once, ever, so no hash suffix is needed for dedup.
 */
export function mapChangelogHistoryToRawEvent(issueKey: string, history: JiraChangelogHistory): RawEventInput {
  return {
    providerEventId: `issue_changelog:${issueKey}:${history.id}`,
    sourceHash: computeSourceHash(history),
    payload: history,
  };
}

/**
 * Remote links are mutable (a link's relationship or target can be edited),
 * so — like issues — the hash is folded into the provider event id.
 */
export function mapRemoteLinkToRawEvent(issueKey: string, link: JiraRemoteLink): RawEventInput {
  const sourceHash = computeSourceHash(link);
  return {
    providerEventId: `remote_link:${issueKey}:${link.id}:${sourceHash}`,
    sourceHash,
    payload: link,
  };
}

/**
 * A site's statuses can be renamed or recategorized, so — like issues — the
 * hash is folded into the provider event id.
 */
export function mapStatusToRawEvent(status: JiraStatus): RawEventInput {
  const sourceHash = computeSourceHash(status);
  return { providerEventId: `status:${status.id}:${sourceHash}`, sourceHash, payload: status };
}

/** What the importer reads back to tell "no longer on this issue in Jira" (removed) apart from "never fetched". */
export interface RemoteLinkManifest {
  linkIds: number[];
}

/**
 * `client.fetchRemoteLinks(issueKey)` (backfill and webhook ingest alike)
 * re-fetches one issue's *entire* remote-link set every run — no
 * incremental filter exists for it — so the full set of link ids seen in one
 * run is exactly the set currently attached to that issue in Jira. Recorded
 * as its own per-issue snapshot, separate from the per-link `remote_link:`
 * rows, mirroring `mapJiraLinkManifestToRawEvent` (packages/zendesk/src/
 * rawEvents.ts) — the same reasoning applies here, just scoped to one issue
 * instead of the whole Zendesk account: `correlateJira`'s manifest-diff
 * sweep needs to tell "this remote link was removed from this issue" apart
 * from "we just haven't re-fetched it yet", and a Jira remote-link removal
 * has no deletion event of its own.
 *
 * Deliberately does NOT fold the content hash into `providerEventId`, for
 * the same reason as the Zendesk mapper: the correlator picks the *latest*
 * manifest per issue by `fetchedAt`, and a link set can legitimately
 * oscillate back to one it held before (removed, then re-added) —
 * content-hash dedup would collapse that onto the original row's stale
 * timestamp. `randomUUID` guarantees every run gets its own row.
 */
export function mapRemoteLinkManifestToRawEvent(issueKey: string, linkIds: number[]): RawEventInput {
  const payload: RemoteLinkManifest = { linkIds: [...linkIds].sort((a, b) => a - b) };
  const sourceHash = computeSourceHash(payload);
  return { providerEventId: `remote_link_manifest:${issueKey}:${randomUUID()}`, sourceHash, payload };
}

/**
 * Records the fact "this issue was found deleted", so `recordJiraIssueDeletion`
 * (./webhook.ts) has a real RawEvent to cite as `NormalizedEvent.sourceRawEventId`
 * — required, not nullable — for the `issue_unlinked` event(s) it emits.
 * There's no fetched payload to snapshot (the issue is gone), unlike every
 * other mapper in this file, so this is the one RawEvent that documents an
 * absence rather than a resource. `randomUUID`, not content-hashed: each
 * detection is its own occurrence, not a snapshot that could collide with an
 * earlier identical one.
 */
export function mapIssueDeletedToRawEvent(issueKey: string): RawEventInput {
  const payload = { issueKey };
  return { providerEventId: `issue_deleted:${issueKey}:${randomUUID()}`, sourceHash: computeSourceHash(payload), payload };
}
