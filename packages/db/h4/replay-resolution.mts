/**
 * H-12 check (read-only, writes nothing): recompute every Resolution
 * commitment's elapsed time and breach instant with the pure engine under the
 * *current* policy versions, and print them as JSON keyed by ticket id, to
 * compare with Zendesk's own fulfil/breach events (scripts/h4-compare).
 * Usage: dotenv -e ../../.env -- tsx h4/replay-resolution.mts > elapsed-now.json
 */
import { evaluateCommitment } from "../../core/src/index";
import { getPrismaClient } from "../src/index";
import { toCommitmentDomain, toNormalizedEventDomain } from "../../commitments/src/evaluate-pipeline";
import { toCalendarVersionDomain } from "../../commitments/src/calendar-domain";

const prisma = getPrismaClient();
const rows = await prisma.commitment.findMany({ where: { kind: "resolution" }, include: { case: true, policyVersion: true, calendarVersion: true } });
const out: Record<string, unknown> = {};
for (const row of rows) {
  const events = (await prisma.normalizedEvent.findMany({
    where: { caseId: row.caseId },
    orderBy: [{ occurredAt: "asc" }, { sourceSequence: "asc" }],
  })).map(toNormalizedEventDomain);
  const pv = row.policyVersion;
  const evaluation = evaluateCommitment(
    toCommitmentDomain(row),
    events,
    {
      id: pv.id, policyId: pv.policyId, version: pv.version, match: pv.match as never, targets: pv.targets as never,
      pauseOnStates: pv.pauseOnStates as never, calendarVersionId: pv.calendarVersionId, warnAtPercent: pv.warnAtPercent,
      effectiveFrom: pv.effectiveFrom.toISOString(),
    },
    toCalendarVersionDomain(row.calendarVersion),
    new Date().toISOString(),
  );
  out[row.case.externalId] = { status: evaluation.status, elapsedSeconds: evaluation.elapsedSeconds, breachedAt: evaluation.effectiveDueAt ?? null, pauseOnStates: pv.pauseOnStates };
}
console.log(JSON.stringify(out));
await prisma.$disconnect();
