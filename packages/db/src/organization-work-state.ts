import type { PrismaClient } from "../generated/prisma/client";

/**
 * PostgreSQL-backed scheduling and leasing for per-organization worker
 * processing. See the `OrganizationWorkState` model for the data contract;
 * this file is the only code that mutates it.
 *
 * Every comparison against "now" happens inside Postgres (`now()`), never
 * with a caller-supplied clock, so worker clock skew cannot make a lease look
 * expired early or a job look due late. Every mutation of a *held* lease is a
 * compare-and-set on (`leaseOwner`, `leaseToken`): the token is incremented by
 * each claim, which is what fences a worker whose lease expired and was
 * re-claimed — it can still run, but it can no longer renew, complete or
 * release anything, and `isLeaseHeld` tells it so before its irreversible
 * steps.
 */

export type OrganizationWorkKind = "active" | "reconciliation";

/**
 * Reconciliation is scheduled this much *early* relative to its interval
 * (capped at 10% of it): the configured interval — 30 minutes at most — is a
 * hard ceiling on the gap between two passes, and claim latency, a busy
 * moment or a slow preceding run would otherwise push each pass a little past
 * it. One minute of a 30-minute interval is noise to the product and is the
 * headroom that keeps "at least every 30 minutes" true under ordinary
 * scheduling jitter.
 */
export function reconciliationSafetyMarginMs(intervalMs: number): number {
  return Math.min(60_000, Math.floor(intervalMs / 10));
}

/** Default lease lifetime. A crashed holder's organization is reclaimable this long after its last renewal. */
export const DEFAULT_LEASE_TTL_MS = 60_000;

/** A granted lease: the proof of ownership every later call must present. */
export interface ClaimedWork {
  organizationId: string;
  kind: OrganizationWorkKind;
  leaseOwner: string;
  /** Fencing token — strictly greater than any token previously issued for this organization. */
  leaseToken: bigint;
  leaseTtlMs: number;
  /** Database time at which this run started — the anchor for start-to-start due times. */
  startedAt: Date;
  /** Non-null when this claim took over an expired lease: the worker that held it and never finished. */
  recoveredFromOwner: string | null;
}

interface ClaimRow {
  organizationId: string;
  kind: OrganizationWorkKind;
  leaseToken: bigint;
  startedAt: Date;
  recoveredFromOwner: string | null;
}

/**
 * Creates the work-state row for any organization that lacks one. New rows
 * are due for active work immediately; their first reconciliation lands at a
 * random point within one interval (less the safety margin) so organizations
 * created together don't all reconcile together forever after. Always inside
 * the interval, so the 30-minute bound holds from the row's creation.
 */
export async function ensureOrganizationWorkStates(
  prisma: PrismaClient,
  options: { reconciliationIntervalMs: number },
): Promise<number> {
  const windowMs = options.reconciliationIntervalMs - reconciliationSafetyMarginMs(options.reconciliationIntervalMs);
  const created = await prisma.$executeRaw`
    INSERT INTO "organization_work_states" ("organizationId", "reconciliationNextDueAt")
    SELECT o."id", now() + (random() * ${windowMs}::double precision) * interval '1 millisecond'
    FROM "organizations" o
    WHERE NOT EXISTS (SELECT 1 FROM "organization_work_states" w WHERE w."organizationId" = o."id")
    ON CONFLICT ("organizationId") DO NOTHING`;
  return Number(created);
}

/**
 * Atomically claims up to `limit` organizations whose active or
 * reconciliation work is due and that nobody holds a live lease on.
 *
 * One statement: candidates are selected `FOR UPDATE SKIP LOCKED` and leased
 * by the same `UPDATE`, so two workers racing for the same rows each get a
 * disjoint set — a row another claimer has locked is skipped, not waited
 * for — and a row is never handed out twice. Oldest-due first, so a backlog
 * drains fairly. When reconciliation is due it is chosen over active work: it
 * is a superset (same ingestion, full re-derivation).
 *
 * An expired lease is reclaimed like a free row; the claim reports who it was
 * taken from, and the abandonment is recorded as a failure on the row.
 */
export async function claimDueOrganizations(
  prisma: PrismaClient,
  options: { owner: string; limit: number; leaseTtlMs?: number },
): Promise<ClaimedWork[]> {
  if (options.limit < 1) return [];
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;

  const rows = await prisma.$queryRaw<ClaimRow[]>`
    WITH candidates AS (
      SELECT "organizationId",
             CASE WHEN "reconciliationNextDueAt" <= now() THEN 'reconciliation' ELSE 'active' END AS "kind",
             "leaseOwner" AS "previousOwner"
      FROM "organization_work_states"
      WHERE ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now())
        AND ("activeNextDueAt" <= now() OR "reconciliationNextDueAt" <= now())
      ORDER BY LEAST("activeNextDueAt", "reconciliationNextDueAt"), "organizationId"
      LIMIT ${options.limit}::int
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "organization_work_states" w SET
      "leaseOwner" = ${options.owner},
      "leaseKind" = c."kind"::"OrganizationWorkKind",
      "leaseToken" = w."leaseToken" + 1,
      "leaseExpiresAt" = now() + ${leaseTtlMs}::int * interval '1 millisecond',
      "lastStartedAt" = now(),
      "consecutiveFailures" = CASE WHEN c."previousOwner" IS NULL THEN w."consecutiveFailures" ELSE w."consecutiveFailures" + 1 END,
      "lastFailureAt" = CASE WHEN c."previousOwner" IS NULL THEN w."lastFailureAt" ELSE now() END,
      "lastError" = CASE WHEN c."previousOwner" IS NULL THEN w."lastError"
                         ELSE 'lease expired while held by ' || c."previousOwner" END
    FROM candidates c
    WHERE w."organizationId" = c."organizationId"
    RETURNING w."organizationId", w."leaseKind" AS "kind", w."leaseToken",
              w."lastStartedAt" AS "startedAt", c."previousOwner" AS "recoveredFromOwner"`;

  return rows.map((row) => ({
    organizationId: row.organizationId,
    kind: row.kind,
    leaseOwner: options.owner,
    leaseToken: BigInt(row.leaseToken),
    leaseTtlMs,
    startedAt: row.startedAt,
    recoveredFromOwner: row.recoveredFromOwner,
  }));
}

/** Extends the lease. False means the lease is gone (re-claimed by another worker, or the row was deleted) and the holder must stop. */
export async function renewLease(prisma: PrismaClient, claim: ClaimedWork): Promise<boolean> {
  const renewed = await prisma.$executeRaw`
    UPDATE "organization_work_states"
    SET "leaseExpiresAt" = now() + ${claim.leaseTtlMs}::int * interval '1 millisecond'
    WHERE "organizationId" = ${claim.organizationId}
      AND "leaseOwner" = ${claim.leaseOwner}
      AND "leaseToken" = ${claim.leaseToken}`;
  return renewed === 1;
}

/**
 * Whether `claim` is still the current lease, read from the row. Used before
 * irreversible steps: a holder that was fenced out stops here instead of
 * publishing stale results.
 */
export async function isLeaseHeld(prisma: PrismaClient, claim: ClaimedWork): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ held: number }[]>`
    SELECT 1 AS "held" FROM "organization_work_states"
    WHERE "organizationId" = ${claim.organizationId}
      AND "leaseOwner" = ${claim.leaseOwner}
      AND "leaseToken" = ${claim.leaseToken}`;
  return rows.length === 1;
}

export interface WorkOutcome {
  failed: boolean;
  error?: string | null;
  /** Active poll interval to schedule the next run with (start-to-start). */
  activeIntervalMs: number;
  /** Reconciliation interval, already capped at the 30-minute ceiling. Used when this run was a reconciliation. */
  reconciliationIntervalMs: number;
}

/**
 * Releases the lease and schedules the next run, only if `claim` is still the
 * current lease (compare-and-set on owner + token); returns false otherwise,
 * in which case nothing was written — a fenced-out worker cannot record
 * results.
 *
 * Next due times are start-to-start, anchored on the claim's own database
 * `lastStartedAt`: a run that finishes early waits out the remainder, and one
 * that overran is due again immediately (a single run, never a burst). A
 * reconciliation is due one interval minus `reconciliationSafetyMarginMs`
 * after the previous one started. A reconciliation run also re-arms the
 * active slot — it did everything an active run does. An active run never touches the reconciliation deadline, so
 * active work can't push it back.
 */
export async function completeWork(prisma: PrismaClient, claim: ClaimedWork, outcome: WorkOutcome): Promise<boolean> {
  const reconciled = claim.kind === "reconciliation";
  const reconciliationDueInMs = outcome.reconciliationIntervalMs - reconciliationSafetyMarginMs(outcome.reconciliationIntervalMs);
  const error = outcome.failed ? (outcome.error ?? "run recorded failures").slice(0, 500) : null;

  const updated = await prisma.$executeRaw`
    UPDATE "organization_work_states" SET
      "leaseOwner" = NULL,
      "leaseKind" = NULL,
      "leaseExpiresAt" = NULL,
      "lastFinishedAt" = now(),
      "lastActiveFinishedAt" = now(),
      "lastReconciliationFinishedAt" = CASE WHEN ${reconciled} THEN now() ELSE "lastReconciliationFinishedAt" END,
      "activeNextDueAt" = "lastStartedAt" + ${outcome.activeIntervalMs}::int * interval '1 millisecond',
      "reconciliationNextDueAt" = CASE WHEN ${reconciled}
        THEN "lastStartedAt" + ${reconciliationDueInMs}::int * interval '1 millisecond'
        ELSE "reconciliationNextDueAt" END,
      "consecutiveFailures" = CASE WHEN ${outcome.failed} THEN "consecutiveFailures" + 1 ELSE 0 END,
      "lastFailureAt" = CASE WHEN ${outcome.failed} THEN now() ELSE "lastFailureAt" END,
      "lastError" = CASE WHEN ${outcome.failed} THEN ${error}::text ELSE NULL END
    WHERE "organizationId" = ${claim.organizationId}
      AND "leaseOwner" = ${claim.leaseOwner}
      AND "leaseToken" = ${claim.leaseToken}`;
  return updated === 1;
}

/**
 * Gives the lease back without scheduling anything: due times are untouched,
 * so the organization is immediately claimable again by another worker.
 * Graceful shutdown uses this for work it is abandoning. Same
 * compare-and-set as `completeWork`.
 */
export async function releaseLease(prisma: PrismaClient, claim: ClaimedWork): Promise<boolean> {
  const released = await prisma.$executeRaw`
    UPDATE "organization_work_states" SET "leaseOwner" = NULL, "leaseKind" = NULL, "leaseExpiresAt" = NULL
    WHERE "organizationId" = ${claim.organizationId}
      AND "leaseOwner" = ${claim.leaseOwner}
      AND "leaseToken" = ${claim.leaseToken}`;
  return released === 1;
}

/**
 * Milliseconds until the earliest moment any organization becomes claimable
 * (due and unleased, or due and its lease expiring), 0 if one already is,
 * null if there are no rows. Lets an idle worker sleep exactly as long as it
 * can instead of polling on a fixed beat.
 */
export async function msUntilNextClaimable(prisma: PrismaClient): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ ms: number | null }[]>`
    SELECT EXTRACT(EPOCH FROM (
             MIN(GREATEST(LEAST("activeNextDueAt", "reconciliationNextDueAt"), COALESCE("leaseExpiresAt", '-infinity'::timestamptz)))
             - now())) * 1000 AS "ms"
    FROM "organization_work_states"`;
  const ms = rows[0]?.ms;
  return ms === null || ms === undefined ? null : Math.max(0, Number(ms));
}

export interface WorkStateSummary {
  organizations: number;
  /** Rows under a live (unexpired) lease. */
  leased: number;
  /** Rows whose lease expired without being completed or re-claimed — a crashed holder not yet recovered. */
  expiredLeases: number;
  /** Organizations currently failing (consecutive failures > 0). */
  failing: number;
  overdueActive: number;
  overdueReconciliation: number;
  /** How late the most overdue active poll is, in ms; 0 if none. Leased rows count: a run that never finishes is lag too. */
  maxActiveLagMs: number;
  maxReconciliationLagMs: number;
  /** The reconciliation guarantee, observed: the most overdue pass relative to its due time. A pass is due at most one interval (≤30 min) after the last started. */
  nextActiveDueAt: Date | null;
  nextReconciliationDueAt: Date | null;
}

/**
 * Accurate per-organization freshness, aggregated. Only meaningful now that
 * each organization has its own persisted schedule; before that the worker
 * had one global heartbeat and nothing per-organization to report.
 */
export async function getWorkStateSummary(prisma: PrismaClient): Promise<WorkStateSummary> {
  const rows = await prisma.$queryRaw<
    {
      organizations: bigint;
      leased: bigint;
      expiredLeases: bigint;
      failing: bigint;
      overdueActive: bigint;
      overdueReconciliation: bigint;
      maxActiveLagMs: number | null;
      maxReconciliationLagMs: number | null;
      nextActiveDueAt: Date | null;
      nextReconciliationDueAt: Date | null;
    }[]
  >`
    SELECT count(*) AS "organizations",
           count(*) FILTER (WHERE "leaseExpiresAt" > now()) AS "leased",
           count(*) FILTER (WHERE "leaseOwner" IS NOT NULL AND "leaseExpiresAt" <= now()) AS "expiredLeases",
           count(*) FILTER (WHERE "consecutiveFailures" > 0) AS "failing",
           count(*) FILTER (WHERE "activeNextDueAt" <= now()) AS "overdueActive",
           count(*) FILTER (WHERE "reconciliationNextDueAt" <= now()) AS "overdueReconciliation",
           EXTRACT(EPOCH FROM (now() - MIN("activeNextDueAt") FILTER (WHERE "activeNextDueAt" <= now()))) * 1000 AS "maxActiveLagMs",
           EXTRACT(EPOCH FROM (now() - MIN("reconciliationNextDueAt") FILTER (WHERE "reconciliationNextDueAt" <= now()))) * 1000 AS "maxReconciliationLagMs",
           MIN("activeNextDueAt") AS "nextActiveDueAt",
           MIN("reconciliationNextDueAt") AS "nextReconciliationDueAt"
    FROM "organization_work_states"`;
  const row = rows[0]!;
  return {
    organizations: Number(row.organizations),
    leased: Number(row.leased),
    expiredLeases: Number(row.expiredLeases),
    failing: Number(row.failing),
    overdueActive: Number(row.overdueActive),
    overdueReconciliation: Number(row.overdueReconciliation),
    maxActiveLagMs: Math.round(Number(row.maxActiveLagMs ?? 0)),
    maxReconciliationLagMs: Math.round(Number(row.maxReconciliationLagMs ?? 0)),
    nextActiveDueAt: row.nextActiveDueAt,
    nextReconciliationDueAt: row.nextReconciliationDueAt,
  };
}
