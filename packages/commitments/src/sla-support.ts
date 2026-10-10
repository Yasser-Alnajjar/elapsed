import { COMMITMENT_KINDS, type CommitmentKind } from "@sla/core";

/**
 * What an integration cannot support, read from the generic, provider-blind
 * `Integration.slaSupport` JSON (N9, Q1): `{ unsupportedKinds: [...], limitations: [...] }`.
 * `null` (every provider that existed before N9) means full support and yields
 * the empty set, so the pipelines behave exactly as they always have.
 *
 * Unsupported kinds are excluded where commitments are created, not hidden in
 * the UI: no commitment of such a kind is ever created, re-resolved or
 * restored for the integration's cases.
 */
export function unsupportedKindsOf(slaSupport: unknown): ReadonlySet<CommitmentKind> {
  if (slaSupport === null || typeof slaSupport !== "object" || Array.isArray(slaSupport)) return EMPTY;
  const kinds = (slaSupport as { unsupportedKinds?: unknown }).unsupportedKinds;
  if (!Array.isArray(kinds)) return EMPTY;
  const known = kinds.filter((kind): kind is CommitmentKind => (COMMITMENT_KINDS as readonly string[]).includes(kind as string));
  return known.length === 0 ? EMPTY : new Set(known);
}

const EMPTY: ReadonlySet<CommitmentKind> = new Set();

/** The `select` fragment every commitments pipeline adds to its case query so the exclusion needs no extra round trip. */
export const SLA_SUPPORT_SELECT = { sourceIntegration: { select: { slaSupport: true } } } as const;
