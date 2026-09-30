import type { NormalizedEvent, SourceRole } from "./types";

/**
 * Fixed rank that orders events from different source roles landing on the
 * same instant: ticket sources first, then work trackers, then code hosts.
 * Each source numbers its own `sourceSequence` independently, so sequences are
 * only comparable within one system; the rank carries no meaning beyond being
 * fixed.
 */
const ROLE_RANK: Record<SourceRole, number> = {
  ticket_source: 0,
  work_tracker: 1,
  code_host: 2,
};

/** A role this table does not know (a row not yet backfilled) sorts after every known one; ties then fall through to `system`, `sourceSequence` and content. */
const rankOf = (role: SourceRole) => ROLE_RANK[role] ?? Number.MAX_SAFE_INTEGER;

function compareStrings(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/**
 * The one total order every engine fold uses for a case's event stream:
 *
 *   1. `occurredAt`
 *   2. `sourceRole` (fixed `ROLE_RANK`), then `system` compared as an opaque
 *      string, so two sources of one role order the same way on every run
 *   3. `sourceSequence` — the provider's own ordering (Zendesk audit order
 *      and event position within the audit; missing on rows written before
 *      the field existed, treated as 0)
 *   4. deterministic fallback on content: `sourceRawEventId`, `type`,
 *      `toState`, `fromState`, `actor`
 *
 * The row `id` is deliberately never used: NormalizedEvents are regenerated
 * wholesale on every normalization run, so ids aren't stable.
 */
export function compareNormalizedEvents(a: NormalizedEvent, b: NormalizedEvent): number {
  return (
    Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
    rankOf(a.sourceRole) - rankOf(b.sourceRole) ||
    compareStrings(a.system, b.system) ||
    (a.sourceSequence ?? 0) - (b.sourceSequence ?? 0) ||
    compareStrings(a.sourceRawEventId, b.sourceRawEventId) ||
    compareStrings(a.type, b.type) ||
    compareStrings(a.toState, b.toState) ||
    compareStrings(a.fromState, b.fromState) ||
    compareStrings(a.actor, b.actor)
  );
}

/** A sorted copy of `events` under `compareNormalizedEvents`. */
export function sortNormalizedEvents<T extends NormalizedEvent>(events: readonly T[]): T[] {
  return [...events].sort(compareNormalizedEvents);
}
