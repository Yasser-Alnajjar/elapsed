import { perfCount, Prisma, type PrismaClient } from "@sla/db";
import {
  deriveLegSpans,
  legAtTime,
  type CommitmentKind,
  type CommitmentStatus,
  type Leg,
  type NormalizedEvent,
} from "@sla/core";
import { toNormalizedEventDomain } from "./evaluate-pipeline";

/**
 * Breach and compliance arithmetic shared by every reader of SLA outcomes: the
 * dashboard's analytics (apps/web `analytics-data.ts`, which re-exports these)
 * and the monthly customer report (`@sla/notifications`). One implementation,
 * so a figure printed on the dashboard and in a report cannot disagree.
 */

/** Distribution of cases by worst commitment status. */
export interface ComplianceBreakdown {
  metSla: number;
  atRisk: number;
  breached: number;
  total: number;
}

export interface BreachOccurrence {
  commitmentId: string;
  caseId: string;
  kind: CommitmentKind;
  caseOpenedAt: Date;
  breachedAt: Date;
}

interface BreachedEvaluationRow {
  commitmentId: string;
  breachedAt: Date;
}

/**
 * The instant each commitment's SLA clock actually crossed its target, read
 * from history instead of recomputed live: the `breachedAt` (working-minutes/
 * calendar/pause-aware target-crossing instant, `evaluateCommitment`'s
 * `effectiveDueAt`) recorded on the earliest persisted `"breached"`
 * Evaluation row per commitment that has one. `runEvaluationPipeline`
 * (packages/commitments/src/evaluate-pipeline.ts) only ever appends
 * Evaluations — id from `stableHash`, written with `skipDuplicates` — and
 * never updates or deletes one, so this is immutable across re-evaluation
 * and reconciliation.
 *
 * Deliberately NOT `evaluatedAt`: that column is only when the row was
 * computed — a poll cycle, a reconciliation sweep, or a one-off historical
 * backfill — which can land arbitrarily far after the real breach instant
 * (e.g. every commitment imported from a customer's SLA backlog gets its
 * first Evaluation, and therefore the same `evaluatedAt`, on the day it was
 * imported, regardless of when each one actually breached weeks or months
 * earlier). Using `evaluatedAt` as a breach-instant proxy silently pulls
 * every such breach onto that one day.
 *
 * A commitment with no breached Evaluation yet, or whose breached Evaluation
 * predates this column (`breachedAt IS NULL` — see
 * packages/commitments/src/scripts/backfill-breached-at.ts for backfilling
 * those), has no entry; callers fall back to `dueAt`. Same `DISTINCT ON`
 * shape as `anomaly-data.ts`'s terminal-evaluation lookup.
 */
export async function getPersistedBreachedAt(
  prisma: PrismaClient,
  commitmentIds: string[],
): Promise<Map<string, Date>> {
  if (commitmentIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<BreachedEvaluationRow[]>(
    Prisma.sql`
      SELECT DISTINCT ON (e."commitmentId") e."commitmentId", e."breachedAt"
      FROM "evaluations" e
      WHERE e."commitmentId" IN (${Prisma.join(commitmentIds)})
        AND e.status = 'breached'
        AND e."breachedAt" IS NOT NULL
      ORDER BY e."commitmentId", e."evaluatedAt" ASC, e.id ASC
    `,
  );
  return new Map(rows.map((row) => [row.commitmentId, row.breachedAt]));
}

/**
 * The commitments that actually breached inside [periodStart, asOfDate].
 * `breachedAtByCommitmentId` (`getPersistedBreachedAt`) is the source of
 * truth; a candidate missing from it (no breached Evaluation persisted yet)
 * falls back to its `dueAt`. Pure and synchronous on purpose — no event
 * loading here, so a candidate whose breach instant falls outside the
 * period never costs more than a map lookup (performance-plan.md Phase 2
 * item 2: this replaces a live, calendar-aware `computeBreachedAt` re-run
 * over every candidate's full event history).
 */
export function findBreachesInPeriod(
  candidates: {
    commitmentId: string;
    caseId: string;
    kind: CommitmentKind;
    caseOpenedAt: Date;
    dueAt: Date;
  }[],
  breachedAtByCommitmentId: ReadonlyMap<string, Date>,
  periodStart: Date,
  asOfDate: Date,
): BreachOccurrence[] {
  const breaches: BreachOccurrence[] = [];
  for (const candidate of candidates) {
    const breachedAt =
      breachedAtByCommitmentId.get(candidate.commitmentId) ?? candidate.dueAt;
    if (breachedAt < periodStart || breachedAt > asOfDate) continue;

    breaches.push({
      commitmentId: candidate.commitmentId,
      caseId: candidate.caseId,
      kind: candidate.kind,
      caseOpenedAt: candidate.caseOpenedAt,
      breachedAt,
    });
  }
  return breaches.sort(
    (a, b) => a.breachedAt.getTime() - b.breachedAt.getTime(),
  );
}

type ComplianceBucket = "met" | "at_risk" | "breached";
const SEVERITY_RANK: Record<ComplianceBucket, number> = {
  met: 0,
  at_risk: 1,
  breached: 2,
};

function bucketOf(status: CommitmentStatus): ComplianceBucket | null {
  if (status === "breached") return "breached";
  if (status === "at_risk") return "at_risk";
  if (status === "on_track" || status === "met") return "met";
  return null; // cancelled — doesn't reflect an SLA outcome
}

/**
 * Worst-status-wins per case: a case with one breached and one on-track
 * commitment counts as breached, not split across two buckets. Cases whose
 * only commitments are cancelled are excluded from the total.
 */
export function summarizeCompliance(
  commitmentStatuses: { caseId: string; status: CommitmentStatus }[],
): ComplianceBreakdown {
  const worstByCaseId = new Map<string, ComplianceBucket>();
  for (const { caseId, status } of commitmentStatuses) {
    const bucket = bucketOf(status);
    if (bucket === null) continue;
    const existing = worstByCaseId.get(caseId);
    if (!existing || SEVERITY_RANK[bucket] > SEVERITY_RANK[existing]) {
      worstByCaseId.set(caseId, bucket);
    }
  }

  let metSla = 0;
  let atRisk = 0;
  let breached = 0;
  for (const bucket of worstByCaseId.values()) {
    if (bucket === "met") metSla++;
    else if (bucket === "at_risk") atRisk++;
    else breached++;
  }

  return { metSla, atRisk, breached, total: worstByCaseId.size };
}


/** A breach and the stage ("leg") the case was in at the instant the clock crossed its target. */
export interface BreachWithLeg {
  breach: BreachOccurrence;
  leg: Leg;
}

/**
 * Attributes each breach to the leg its case was in when it happened: the
 * "breaches by stage" figure. Events are loaded only for the cases that
 * actually breached (never the full candidate set), narrow-selected.
 */
export async function attributeBreachLegs(prisma: PrismaClient, breaches: BreachOccurrence[]): Promise<BreachWithLeg[]> {
  const caseIds = [...new Set(breaches.map((b) => b.caseId))];
  const eventRows =
    caseIds.length > 0
      ? await prisma.normalizedEvent.findMany({
          where: { caseId: { in: caseIds } },
          select: {
            id: true,
            caseId: true,
            type: true,
            occurredAt: true,
            actor: true,
            system: true,
            fromState: true,
            toState: true,
            sourceRawEventId: true,
            sourceSequence: true,
            sourceRole: true,
          },
        })
      : [];
  const eventsByCaseId = new Map<string, NormalizedEvent[]>();
  for (const row of eventRows) {
    const domainEvent = toNormalizedEventDomain(row);
    const existing = eventsByCaseId.get(row.caseId);
    if (existing) existing.push(domainEvent);
    else eventsByCaseId.set(row.caseId, [domainEvent]);
  }

  return breaches.map((breach) => {
    const { spans } = deriveLegSpans(eventsByCaseId.get(breach.caseId) ?? [], {
      caseOpenedAt: breach.caseOpenedAt.toISOString(),
    });
    perfCount("deriveLegSpans");
    return { breach, leg: legAtTime(spans, breach.breachedAt.toISOString()) };
  });
}
