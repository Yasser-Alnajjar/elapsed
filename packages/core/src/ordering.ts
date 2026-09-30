import type { NormalizedEvent } from "./types";

/**
 * Fixed rank that orders events from different systems landing on the same
 * instant. Each system numbers its own `sourceSequence` independently, so
 * sequences are only comparable within one system; the rank itself carries
 * no meaning beyond being fixed. Ticket sources come first.
 */
const SYSTEM_RANK: Record<string, number> = {
  zendesk: 0,
  intercom: 1,
  jira: 2,
  linear: 3,
  github: 4,
};

/** A system this table does not know sorts after every known one; ties then fall through to `sourceSequence` and content. */
const rankOf = (system: string) => SYSTEM_RANK[system] ?? Number.MAX_SAFE_INTEGER;

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
 *   2. `system` (fixed `SYSTEM_RANK`)
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
    rankOf(a.system) - rankOf(b.system) ||
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
