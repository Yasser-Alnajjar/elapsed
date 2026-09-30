import type { CommitmentKind, NormalizedState, SLAPolicyMatch, SLAPolicyVersion } from "@sla/core";

/** The persisted policy-version columns (plus the owning policy's) `toPolicyVersionDomain` reads. */
export interface PolicyVersionDomainRow {
  id: string;
  policyId: string;
  version: number;
  match: unknown;
  targets: unknown;
  pauseOnStates: string[];
  calendarVersionId: string;
  warnAtPercent: number[];
  effectiveFrom: Date;
  calendarIsExplicit: boolean;
  policy: { position: number | null; source: "imported" | "native"; sourceProvider: string | null };
}

/**
 * Persisted policy version (with its owning policy) -> the core's
 * `SLAPolicyVersion`. One mapping for every pipeline and the replay harness,
 * so a new policy column reaches all of them at once. `sourceKey` is the
 * owning policy's `sourceProvider`, compared by the core as an opaque string
 * against the case's source (N1.11).
 */
export function toPolicyVersionDomain(row: PolicyVersionDomainRow): SLAPolicyVersion {
  return {
    id: row.id,
    policyId: row.policyId,
    version: row.version,
    match: row.match as SLAPolicyMatch,
    targets: row.targets as { kind: CommitmentKind; minutes: number }[],
    pauseOnStates: row.pauseOnStates as NormalizedState[],
    calendarVersionId: row.calendarVersionId,
    warnAtPercent: row.warnAtPercent,
    effectiveFrom: row.effectiveFrom.toISOString(),
    policyPosition: row.policy.position,
    policySource: row.policy.source,
    sourceKey: row.policy.sourceProvider,
    calendarIsExplicit: row.calendarIsExplicit,
  };
}
