import { computeSourceHash } from "./hash";
import type { LinearAttachment, LinearHistoryEntry, LinearIssue } from "./types";

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
export function mapIssueToRawEvent(issue: LinearIssue): RawEventInput {
  const sourceHash = computeSourceHash(issue);
  return { providerEventId: `issue:${issue.id}:${sourceHash}`, sourceHash, payload: issue };
}

/**
 * History entries are NOT immutable: Linear coalesces rapid state changes by
 * the same actor into a single entry, rewriting its `toState` in place under
 * the same id. So — like issues and attachments — the hash is folded into the
 * provider event id, letting an edited entry land as a new RawEvent instead of
 * being swallowed by skipDuplicates. The normalizer keeps the latest version
 * per entry id.
 *
 * The payload must include the entry's `updatedAt`: a rewrite advances it, so
 * a state that returns to one seen before (A → B → A) still hashes differently
 * from the first A. Without it the third version collides with the first, is
 * skipped as a duplicate, and the normalizer keeps the stale B.
 */
export function mapHistoryEntryToRawEvent(issueId: string, entry: LinearHistoryEntry): RawEventInput {
  const sourceHash = computeSourceHash(entry);
  return {
    providerEventId: `issue_history:${issueId}:${entry.id}:${sourceHash}`,
    sourceHash,
    payload: entry,
  };
}

/**
 * Attachments are mutable (title/subtitle/url can be edited), so — like
 * issues — the hash is folded into the provider event id.
 */
export function mapAttachmentToRawEvent(issueId: string, attachment: LinearAttachment): RawEventInput {
  const sourceHash = computeSourceHash(attachment);
  return {
    providerEventId: `attachment:${issueId}:${attachment.id}:${sourceHash}`,
    sourceHash,
    payload: attachment,
  };
}
