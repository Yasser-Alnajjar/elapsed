/**
 * The normalization abort guards of plan 09, 6.4, as pure functions of the
 * counts, so every boundary row of the plan's tables is a one-line check.
 *
 * L live cases of this integration (the whole integration, in any pass)
 * B   distinct tickets the pass attempts
 * F   members of B that fail mapping or derivation
 * D   distinct ids in the deletion set that are currently live
 * R   existing live cases whose derived lifecycle state (open/closed) flips
 * N   distinct tickets in the pass that are not currently live cases
 * C   the configured live-case ceiling
 */
export interface GuardCounts {
  L: number;
  B: number;
  F: number;
  D: number;
  R: number;
  N: number;
  C: number;
}

export type GuardCode = "live_case_ceiling" | "mass_deletion" | "mass_record_failure" | "mass_lifecycle_change";

export const MASS_DELETION_MIN = 3;
export const MASS_DELETION_RATIO = 0.05;
export const RECORD_FAILURE_MIN = 3;
export const RECORD_FAILURE_RATIO = 0.25;
export const LIFECYCLE_MIN = 10;
export const LIFECYCLE_RATIO = 0.25;

/** The working default before the benchmark gate fixes the ceiling (R4): conservative and explicitly unvalidated. */
export const DEFAULT_LIVE_CASE_CEILING = 5_000;
const MAX_CONFIGURABLE_CEILING = 100_000;

/** `CUSTOM_PROVIDER_LIVE_CASE_CEILING`, else the unvalidated default. Never a literal in the guard itself. */
export function liveCaseCeiling(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CUSTOM_PROVIDER_LIVE_CASE_CEILING);
  return Number.isInteger(raw) && raw >= 1 && raw <= MAX_CONFIGURABLE_CEILING ? raw : DEFAULT_LIVE_CASE_CEILING;
}

export const exceedsCeiling = (c: GuardCounts): boolean => c.L + c.N > c.C;
export const exceedsMassDeletion = (c: GuardCounts): boolean => c.D > Math.max(MASS_DELETION_MIN, MASS_DELETION_RATIO * c.L);
export const exceedsRecordFailure = (c: GuardCounts): boolean => c.F >= RECORD_FAILURE_MIN && c.F > RECORD_FAILURE_RATIO * c.B;
export const exceedsLifecycleChange = (c: GuardCounts): boolean => c.R >= LIFECYCLE_MIN && c.R > LIFECYCLE_RATIO * c.L;

/**
 * The first guard that fires, in this order: the ceiling (it precedes any
 * full-set rewrite), mass deletion, failed records, lifecycle change. Null
 * when the pass may project. `lifecycleOverridden` skips ONLY the lifecycle
 * guard; nothing else is ever skippable (plan 09, 6.11).
 */
export function firstFiringGuard(counts: GuardCounts, options: { lifecycleOverridden?: boolean } = {}): GuardCode | null {
  if (exceedsCeiling(counts)) return "live_case_ceiling";
  if (exceedsMassDeletion(counts)) return "mass_deletion";
  if (exceedsRecordFailure(counts)) return "mass_record_failure";
  if (!options.lifecycleOverridden && exceedsLifecycleChange(counts)) return "mass_lifecycle_change";
  return null;
}
