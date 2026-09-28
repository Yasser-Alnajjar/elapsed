import { getPrismaClient, type PrismaClient } from "@sla/db";
import {
  evaluateCommitment,
  type BusinessCalendarVersion,
  type NormalizedEvent,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { toCommitmentDomain, toNormalizedEventDomain } from "../evaluate-pipeline";

/**
 * One-off, idempotent backfill for `Evaluation` rows saved before
 * `Evaluation.breachedAt` shipped: `runEvaluationPipeline` now persists it on
 * every new `"breached"` evaluation (`toEvaluationCreateInput`), but a row
 * written before that change has `breachedAt = null` and needs the same
 * value computed after the fact. Recomputes each affected commitment's true
 * breach instant with the same pure `evaluateCommitment` the pipeline uses —
 * `effectiveDueAt` is derived only from event history, calendar and policy,
 * never from when it's computed, so this produces the exact value the
 * pipeline would have persisted at the time, not an approximation. Safe to
 * run repeatedly: a row that already has `breachedAt` set is left untouched,
 * so a second run makes zero writes. Run via `pnpm --filter @sla/commitments
 * backfill:breached-at`.
 */

export interface BackfillBreachedAtResult {
  commitmentsConsidered: number;
  evaluationRowsUpdated: number;
  commitmentsSkipped: { commitmentId: string; reason: string }[];
}

export async function backfillBreachedAt(
  prisma: PrismaClient,
  asOf: string = new Date().toISOString(),
): Promise<BackfillBreachedAtResult> {
  const result: BackfillBreachedAtResult = {
    commitmentsConsidered: 0,
    evaluationRowsUpdated: 0,
    commitmentsSkipped: [],
  };

  const staleRows = await prisma.evaluation.findMany({
    where: { status: "breached", breachedAt: null },
    select: { commitmentId: true },
    distinct: ["commitmentId"],
  });
  const commitmentIds = staleRows.map((row) => row.commitmentId);
  result.commitmentsConsidered = commitmentIds.length;
  if (commitmentIds.length === 0) return result;

  const commitmentRows = await prisma.commitment.findMany({
    where: { id: { in: commitmentIds } },
  });

  const policyVersionIds = [...new Set(commitmentRows.map((c) => c.policyVersionId))];
  const calendarVersionIds = [...new Set(commitmentRows.map((c) => c.calendarVersionId))];
  const caseIds = [...new Set(commitmentRows.map((c) => c.caseId))];

  const [policyVersionRows, calendarVersionRows, eventRows] = await Promise.all([
    prisma.sLAPolicyVersion.findMany({ where: { id: { in: policyVersionIds } } }),
    prisma.businessCalendarVersion.findMany({ where: { id: { in: calendarVersionIds } } }),
    prisma.normalizedEvent.findMany({
      where: { caseId: { in: caseIds } },
      orderBy: [{ caseId: "asc" }, { occurredAt: "asc" }, { sourceSequence: "asc" }],
    }),
  ]);

  const policyVersionsById = new Map<string, SLAPolicyVersion>(
    policyVersionRows.map((row) => [
      row.id,
      {
        id: row.id,
        policyId: row.policyId,
        version: row.version,
        match: row.match as SLAPolicyMatch,
        targets: row.targets as { kind: SLAPolicyVersion["targets"][number]["kind"]; minutes: number }[],
        pauseOnStates: row.pauseOnStates as SLAPolicyVersion["pauseOnStates"],
        calendarVersionId: row.calendarVersionId,
        warnAtPercent: row.warnAtPercent,
        effectiveFrom: row.effectiveFrom.toISOString(),
      },
    ]),
  );
  const calendarsById = new Map<string, BusinessCalendarVersion>(
    calendarVersionRows.map((row) => [
      row.id,
      {
        id: row.id,
        version: row.version,
        timezone: row.timezone,
        weekly: row.weekly as unknown as WeeklyWindow[],
        holidays: row.holidays,
        alwaysOpen: row.alwaysOpen,
      },
    ]),
  );
  const eventsByCaseId = new Map<string, NormalizedEvent[]>();
  for (const row of eventRows) {
    const domainEvent = toNormalizedEventDomain(row);
    const existing = eventsByCaseId.get(row.caseId);
    if (existing) existing.push(domainEvent);
    else eventsByCaseId.set(row.caseId, [domainEvent]);
  }

  for (const row of commitmentRows) {
    const policyVersion = policyVersionsById.get(row.policyVersionId);
    const calendar = calendarsById.get(row.calendarVersionId);
    if (!policyVersion || !calendar) {
      result.commitmentsSkipped.push({
        commitmentId: row.id,
        reason: !policyVersion ? "missing policy version" : "missing calendar version",
      });
      continue;
    }

    const evaluation = evaluateCommitment(
      toCommitmentDomain(row),
      eventsByCaseId.get(row.caseId) ?? [],
      policyVersion,
      calendar,
      asOf,
    );

    if (evaluation.status !== "breached" || !evaluation.effectiveDueAt) {
      result.commitmentsSkipped.push({
        commitmentId: row.id,
        reason: `recomputed status is "${evaluation.status}", not "breached"`,
      });
      continue;
    }

    const updated = await prisma.evaluation.updateMany({
      where: { commitmentId: row.id, status: "breached", breachedAt: null },
      data: { breachedAt: new Date(evaluation.effectiveDueAt) },
    });
    result.evaluationRowsUpdated += updated.count;
  }

  return result;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  backfillBreachedAt(getPrismaClient())
    .then((result) => {
      console.log(
        `Backfilled breachedAt for ${result.evaluationRowsUpdated} Evaluation row(s) across ${result.commitmentsConsidered} commitment(s).`,
      );
      if (result.commitmentsSkipped.length > 0) {
        console.log(`Skipped ${result.commitmentsSkipped.length} commitment(s):`, result.commitmentsSkipped);
      }
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("backfill-breached-at failed:", error);
      process.exit(1);
    });
}
