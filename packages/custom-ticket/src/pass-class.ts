/**
 * Which performance limit a `custom` projection pass is held to (plan 09
 * §6.10, N9.7-F1, owner decision of 2026-10-09, Option 2).
 *
 *   initial_projection  the passes that project an integration's first import:
 *                       while the import is still being read, the pass that
 *                       completes it, and any pass that creates cases for an
 *                       integration that has none. Held to the first-import
 *                       bound.
 *   recurring           every other pass, whatever triggered it: the poll, the
 *                       reconciliation sweep, and the forced re-projections
 *                       (an operator's re-normalization request, a configuration
 *                       version activation or rollback). They reprocess cases
 *                       that already exist, so they are held to the recurring
 *                       limit; any case such a pass creates is bounded by the
 *                       live-case ceiling (L + N <= C) and counts in that pass.
 *
 * The class is decided by the integration's state, never by the trigger, so a
 * forced re-projection during the first import belongs to the import and one
 * after it is recurring. Classification never changes what a pass does: it is
 * reported (the `custom_projection_pass` log line) so the benchmark and the
 * N8-S3 review read each pass against the right limit.
 */
export type ProjectionPassClass = "initial_projection" | "recurring";

/** N8-S3, approved for recurring sync only: organization-lock hold at p95. */
export const RECURRING_LOCK_HOLD_LIMIT_MS = 10_000;
/** N8-S3: organization sweep at p95, every pass, first import included. */
export const ORGANIZATION_SWEEP_LIMIT_MS = 30_000;
/** First-import bound on the organization-lock hold of an initial-projection pass (plan 09 §6.10). */
export const FIRST_IMPORT_LOCK_HOLD_BOUND_MS = 15_000;

export interface PassClassInput {
  /** `cursor.backfillCompletedAt`: set by ingest once the whole import window has been read. */
  backfillCompletedAt: string | null | undefined;
  /** Written after a pass that completed without error; null until the first one. */
  lastSuccessfulSyncAt: Date | null;
  /** L: live cases of the integration before this pass. */
  liveCases: number;
  /** N: cases this pass would create. */
  newCases: number;
}

export function classifyProjectionPass(input: PassClassInput): ProjectionPassClass {
  if (input.liveCases === 0 && input.newCases > 0) return "initial_projection";
  if (!input.backfillCompletedAt) return "initial_projection";
  const completedAt = Date.parse(input.backfillCompletedAt);
  // The pass that completes the import runs before any successful pass has
  // been recorded after the import finished; a failed one leaves it pending.
  if (Number.isNaN(completedAt)) return "initial_projection";
  if (input.lastSuccessfulSyncAt === null || input.lastSuccessfulSyncAt.getTime() < completedAt) return "initial_projection";
  return "recurring";
}

/** The lock-hold limit a pass of this class is held to. */
export function lockHoldLimitMs(passClass: ProjectionPassClass): number {
  return passClass === "initial_projection" ? FIRST_IMPORT_LOCK_HOLD_BOUND_MS : RECURRING_LOCK_HOLD_LIMIT_MS;
}
