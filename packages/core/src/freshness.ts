/** Result of comparing an integration's successful-sync watermark to a poll cadence. */
export interface FreshnessAssessment {
  fresh: boolean;
  /** ISO instant at which the source became stale, or null while fresh. */
  staleSince: string | null;
}

export interface AssessFreshnessInput {
  lastSuccessfulSyncAt: Date | string | null;
  asOf: Date | string;
  expectedIntervalMs: number;
  graceFactor?: number;
}

/**
 * Provider-neutral freshness metadata. This intentionally has no knowledge
 * of cases, commitments, or SLA clock calculations.
 */
export function assessFreshness(input: AssessFreshnessInput): FreshnessAssessment {
  const asOf = new Date(input.asOf).getTime();
  const lastSuccess = input.lastSuccessfulSyncAt === null ? Number.NaN : new Date(input.lastSuccessfulSyncAt).getTime();
  const interval = input.expectedIntervalMs;
  const grace = input.graceFactor ?? 3;
  if (!Number.isFinite(asOf) || !Number.isFinite(interval) || interval <= 0 || !Number.isFinite(grace) || grace <= 0) {
    throw new Error("Freshness requires a valid asOf, positive expectedIntervalMs, and positive graceFactor");
  }
  // A never-successful source is stale, but there is no defensible earlier
  // instant to display. `asOf` says exactly when that fact was observed.
  if (!Number.isFinite(lastSuccess)) return { fresh: false, staleSince: new Date(asOf).toISOString() };
  const staleAt = lastSuccess + interval * grace;
  return asOf <= staleAt
    ? { fresh: true, staleSince: null }
    : { fresh: false, staleSince: new Date(staleAt).toISOString() };
}
