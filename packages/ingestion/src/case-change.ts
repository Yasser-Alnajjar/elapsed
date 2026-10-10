import type { CaseFacts } from "./contract";

/** The stored columns the projector writes on an existing case, as read back before the upsert. */
export interface StoredCaseFields {
  customerId: string | null;
  subject: string | null;
  assigneeName: string | null;
  priority: string | null;
  channel: string | null;
  closedAt: Date | null;
  requesterName: string | null;
  tier: string | null;
  tags: string[];
  attributes: unknown;
}

export const STORED_CASE_FIELDS = {
  customerId: true,
  subject: true,
  assigneeName: true,
  priority: true,
  channel: true,
  closedAt: true,
  requesterName: true,
  tier: true,
  tags: true,
  attributes: true,
} as const;

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
};

/** Structural JSON equality that ignores key order (Postgres `jsonb` does not keep it). */
export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a ?? null)) === JSON.stringify(sortKeys(b ?? null));

const sameTime = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());

/**
 * True when writing `facts` (with the customer it resolved to) would change what
 * is stored. Mirrors the projector's own write rules: a field the adapter
 * omitted (`undefined`) is not written, so it can never be a change. Read-only.
 */
export function caseFieldsChanged(stored: StoredCaseFields, facts: CaseFacts, customerId: string | null): boolean {
  if (stored.customerId !== customerId) return true;
  if (stored.subject !== facts.subject || stored.assigneeName !== facts.assigneeName) return true;
  if (stored.priority !== facts.priority || stored.channel !== facts.channel) return true;
  if (!sameTime(stored.closedAt, facts.closedAt)) return true;
  if (facts.requesterName !== undefined && stored.requesterName !== facts.requesterName) return true;
  if (facts.tier !== undefined && stored.tier !== facts.tier) return true;
  if (facts.tags !== undefined && (stored.tags.length !== facts.tags.length || stored.tags.some((tag, i) => tag !== facts.tags![i]))) return true;
  if (facts.attributes !== undefined && !sameJson(stored.attributes, facts.attributes)) return true;
  return false;
}
