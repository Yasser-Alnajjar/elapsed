/** Everything that identifies a derived event's content: two events with the same key are interchangeable. */
export interface EventContent {
  sourceRawEventId: string;
  sourceSequence: number;
  type: string;
  occurredAt: Date | string;
  actor: string;
  sourceRole?: string | null;
  fromState: string | null;
  toState: string | null;
}

export function normalizedEventKey(event: EventContent): string {
  return [
    event.sourceRawEventId,
    event.sourceSequence,
    event.type,
    new Date(event.occurredAt).getTime(),
    event.actor,
    // A stored row with no role (written before N1.5's backfill) never matches
    // its derived twin, so it is replaced by one that has it.
    event.sourceRole ?? "",
    event.fromState ?? "",
    event.toState ?? "",
  ].join("|");
}

/**
 * The write needed to turn `stored` into `derived`: derived events with no
 * identical stored twin are created, stored events with no identical derived
 * twin are deleted, the rest are left alone. Multiset-aware, so two events
 * with the same content are matched one-to-one rather than collapsed.
 */
export function diffNormalizedEvents<D extends EventContent>(
  stored: readonly (EventContent & { id: string })[],
  derived: readonly D[],
): { toCreate: D[]; toDeleteIds: string[] } {
  const storedIdsByKey = new Map<string, string[]>();
  for (const row of stored) {
    const key = normalizedEventKey(row);
    const ids = storedIdsByKey.get(key);
    if (ids) ids.push(row.id);
    else storedIdsByKey.set(key, [row.id]);
  }
  const toCreate: D[] = [];
  for (const event of derived) {
    const ids = storedIdsByKey.get(normalizedEventKey(event));
    if (ids && ids.length > 0) ids.pop();
    else toCreate.push(event);
  }
  return { toCreate, toDeleteIds: [...storedIdsByKey.values()].flat() };
}
