import { CASE_SOURCE_CONNECTED, Prisma, type PrismaClient } from "@sla/db";
import { detectCycleTimeAnomaly, type CommitmentKind } from "@sla/core";
import type { CycleTimeAnomalyRow } from "./types/dashboard";

// A single very slow or fast case shouldn't flip the call — this is how
// many of a customer/kind's most-recently-closed commitments count as
// "recent" for the comparison.
const RECENT_WINDOW_COUNT = 5;
// Dashboard callout is a NICE TO HAVE surface (roadmap step 25) — cap it
// like the other dashboard lists (AT_RISK_LIMIT, AGING_LIMIT) rather than
// growing unbounded as more customers accumulate anomalies.
const ANOMALY_LIMIT = 5;
// `detectCycleTimeAnomaly` needs >=12 baseline + >=5 recent samples per
// (customer, kind) group (packages/core/src/anomaly.ts's defaults) before it
// says anything, so the lookback has to stay wide enough for a lower-volume
// customer to still accumulate that history — but it can't stay unbounded,
// or this query keeps scanning more closed commitments every day the
// organization exists (performance-plan.md Phase 2 item 3).
const ANOMALY_LOOKBACK_DAYS = 180;

interface CycleTimeSample {
  closedAt: Date;
  cycleTimeMinutes: number;
}

interface TerminalEvaluationRow {
  commitmentId: string;
  elapsedSeconds: number;
}

/**
 * Statistical (not AI/LLM — Phase 10's DO NOT BUILD list) anomaly detection
 * on cycle times, roadmap step 25: for each (customer, commitment kind)
 * with enough closed-commitment history in the trailing
 * `ANOMALY_LOOKBACK_DAYS`, compares the last few cycle times against
 * everything before them via `detectCycleTimeAnomaly`'s median/MAD check.
 * "Cycle time" here is the terminal `Evaluation.elapsedSeconds`, in
 * minutes, for a commitment — the same working-time snapshot the pipeline
 * persisted at `evaluatedAt <= commitment.closedAt` when it finalized the
 * commitment (`evaluate-pipeline.ts`), not a value recomputed here, and not
 * a later status correction from the reconciliation sweep (at most every 30 minutes) (which
 * keeps a finalized commitment's original `closedAt` even when a later
 * Evaluation revises its status).
 */
export async function getCycleTimeAnomalies(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date = new Date(),
): Promise<CycleTimeAnomalyRow[]> {
  const lookbackStart = new Date(
    asOfDate.getTime() - ANOMALY_LOOKBACK_DAYS * 86_400_000,
  );

  const closedCommitments = await prisma.commitment.findMany({
    where: {
      case: { organizationId, deletedAt: null, customerId: { not: null }, ...CASE_SOURCE_CONNECTED },
      closedAt: { gte: lookbackStart, lte: asOfDate },
      status: { in: ["met", "breached"] },
    },
    select: {
      id: true,
      kind: true,
      closedAt: true,
      case: { select: { customer: { select: { id: true, name: true } } } },
    },
  });

  if (closedCommitments.length === 0) return [];

  // One row per commitment — its terminal evaluation — instead of every
  // evaluation ever recorded for it (performance-plan.md Phase 2 item 3).
  // Raw `DISTINCT ON` rather than Prisma's `distinct` (used the same way,
  // but without this bound, for `latestEvaluationRows` in
  // `runEvaluationPipeline`) because "closest evaluation at or before this
  // commitment's own closedAt" is a per-row join condition, not a single
  // scalar filter Prisma's query API can express.
  const terminalRows = await prisma.$queryRaw<TerminalEvaluationRow[]>(
    Prisma.sql`
      SELECT DISTINCT ON (e."commitmentId") e."commitmentId", e."elapsedSeconds"
      FROM "evaluations" e
      JOIN "commitments" c ON c.id = e."commitmentId"
      WHERE e."commitmentId" IN (${Prisma.join(closedCommitments.map((c) => c.id))})
        AND e."evaluatedAt" <= c."closedAt"
      ORDER BY e."commitmentId", e."evaluatedAt" DESC, e."id" DESC
    `,
  );
  const elapsedSecondsByCommitmentId = new Map(
    terminalRows.map((row) => [row.commitmentId, row.elapsedSeconds]),
  );

  const samplesByGroup = new Map<
    string,
    { customerName: string; kind: CommitmentKind; samples: CycleTimeSample[] }
  >();

  for (const commitment of closedCommitments) {
    const customer = commitment.case.customer;
    const closedAt = commitment.closedAt;
    if (!customer || !closedAt) continue;

    const elapsedSeconds = elapsedSecondsByCommitmentId.get(commitment.id);
    if (elapsedSeconds == null) continue;

    const groupKey = `${customer.id}:${commitment.kind}`;
    const sample: CycleTimeSample = {
      closedAt,
      cycleTimeMinutes: elapsedSeconds / 60,
    };
    const group = samplesByGroup.get(groupKey);
    if (group) group.samples.push(sample);
    else
      samplesByGroup.set(groupKey, {
        customerName: customer.name,
        kind: commitment.kind,
        samples: [sample],
      });
  }

  const anomalies: CycleTimeAnomalyRow[] = [];
  for (const group of samplesByGroup.values()) {
    const sorted = [...group.samples].sort(
      (a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
    );
    const recent = sorted.slice(-RECENT_WINDOW_COUNT);
    const baseline = sorted.slice(0, -RECENT_WINDOW_COUNT);

    const anomaly = detectCycleTimeAnomaly(
      baseline.map((s) => s.cycleTimeMinutes),
      recent.map((s) => s.cycleTimeMinutes),
    );
    if (!anomaly) continue;

    anomalies.push({
      customerName: group.customerName,
      kind: group.kind,
      ...anomaly,
    });
  }

  anomalies.sort(
    (a, b) => Math.abs(b.modifiedZScore) - Math.abs(a.modifiedZScore),
  );
  return anomalies.slice(0, ANOMALY_LIMIT);
}
