import type { PrismaClient } from "@sla/db";
import {
  deriveNextReplyCycles,
  findFirstResponseEvent,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type CommitmentStatus,
  type NormalizedEvent,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
} from "@sla/core";
import { persistNextReplyCommitments, planCycleCommitments } from "./cycle-commitments";
import { ACTIVE_COMMITMENT_WHERE } from "./active-commitment";
import { toPolicyVersionDomain } from "./policy-domain";
import { chunk, loadPolicyContext, type PolicyContext } from "./tick-context";
import { toNormalizedEventDomain } from "./evaluate-pipeline";
import { COMMITMENT_KINDS, latestVersionPerPolicy, pickAnchorCommitment } from "./pipeline";
import { toCalendarVersionDomain } from "./calendar-domain";

export interface NextReplyCyclePipelineResult {
  casesConsidered: number;
  cyclesCreated: number;
  cyclesCancelled: number;
  cyclesRestored: number;
  casesFailed: { caseId: string; error: string }[];
}

/**
 * Makes every case's persisted Next Reply commitments match its derived
 * cycles (`persistNextReplyCommitments`), across every case in an
 * organization. Runs after `runCommitmentPipeline` and before
 * `runEvaluationPipeline` in every orchestration path (worker cycle, webhook
 * tail, source-sync): it needs a case's frozen first-response or resolution
 * commitment as its policy/calendar anchor, the same "a case's commitments
 * always share one policy and calendar version" rule `runCommitmentPipeline`
 * already follows for its own sibling kinds (pipeline.ts) — this is
 * deliberately not a second, independent policy-resolution mechanism.
 *
 * A case with no such anchor commitment yet (no matching policy) is skipped:
 * there's nothing to anchor a Next Reply cycle to, and `runCommitmentPipeline`
 * already reports that case's unmatched-policy state.
 *
 * A case whose anchor policy version has no `next_reply` target still runs
 * through `persistNextReplyCommitments` with `cycles: []` — not skipped —
 * so a previously-live cycle gets cancelled by the same planner that cancels
 * any other vanished cycle (`planCycleCommitments`): losing the target isn't
 * different from losing every cycle.
 *
 * Never evaluates a cycle's commitment. `runEvaluationPipeline` excludes
 * `next_reply` from its scope until Next Reply evaluation is implemented
 * (evaluate-pipeline.ts).
 */
export interface NextReplyCyclePipelineOptions {
  asOf?: string;
  /**
   * `"all"` (default): every case with an anchor commitment — webhook tails,
   * tests and the hourly reconciliation sweep. `"active"`: only cases that can
   * have changed since the last poll — an active (unfinalized, uncancelled)
   * commitment, or a NormalizedEvent created at/after `changedSince`. A
   * finalized case with no new events derives the same cycles it did last
   * time, and the reconciliation sweep is the backstop for anything a poll
   * missed. Requires `changedSince`.
   */
  scope?: "all" | "active";
  changedSince?: Date;
  /** Policy/calendar reads a worker tick loaded once for all three pipelines. */
  context?: PolicyContext;
  /** Limits the run to these cases (webhook/source-sync). Omit for the whole organization. */
  caseIds?: readonly string[];
}

export async function runNextReplyCyclePipeline(
  prisma: PrismaClient,
  organizationId: string,
  options: NextReplyCyclePipelineOptions = {},
): Promise<NextReplyCyclePipelineResult> {
  const asOf = options.asOf ?? new Date().toISOString();

  const result: NextReplyCyclePipelineResult = {
    casesConsidered: 0,
    cyclesCreated: 0,
    cyclesCancelled: 0,
    cyclesRestored: 0,
    casesFailed: [],
  };

  const { policyVersionRows } = options.context ?? (await loadPolicyContext(prisma, organizationId));
  if (policyVersionRows.length === 0) return result;

  const allPolicyVersions: SLAPolicyVersion[] = policyVersionRows.map(toPolicyVersionDomain);
  const policyVersionsById = new Map(allPolicyVersions.map((pv) => [pv.id, pv]));
  const activePolicyVersions = latestVersionPerPolicy(allPolicyVersions);

  const calendarsById = new Map<string, BusinessCalendarVersion>(
    policyVersionRows.map((row) => [row.calendarVersion.id, toCalendarVersionDomain(row.calendarVersion)]),
  );

  if (options.scope === "active" && !options.changedSince) {
    throw new Error('runNextReplyCyclePipeline: scope "active" requires changedSince');
  }
  const cases = await prisma.case.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(options.caseIds ? { id: { in: [...options.caseIds] } } : {}),
      // A case with no anchor commitment is skipped below, so never load it.
      AND: [
        { commitments: { some: { kind: { in: COMMITMENT_KINDS } } } },
        ...(options.scope === "active"
          ? [
              {
                OR: [
                  { commitments: { some: ACTIVE_COMMITMENT_WHERE } },
                  { normalizedEvents: { some: { createdAt: { gte: options.changedSince } } } },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      // The same anchor kinds runCommitmentPipeline creates; a persisted
      // Next Reply commitment is never its own anchor.
      commitments: {
        where: { kind: { in: COMMITMENT_KINDS } },
        select: { kind: true, policyVersionId: true, calendarVersionId: true },
      },
    },
  });

  // Calendar versions frozen onto an anchor commitment that aren't already
  // loaded (e.g. a customer override that has since moved to a newer version).
  const missingCalendarVersionIds = [
    ...new Set(
      cases.flatMap((c) => c.commitments.map((cm) => cm.calendarVersionId).filter((id) => !calendarsById.has(id))),
    ),
  ];
  if (missingCalendarVersionIds.length > 0) {
    const rows = await prisma.businessCalendarVersion.findMany({ where: { id: { in: missingCalendarVersionIds } } });
    for (const row of rows) calendarsById.set(row.id, toCalendarVersionDomain(row));
  }

  // Only cases with an anchor need their events loaded — a case with no
  // matched policy yet is skipped below without ever touching NormalizedEvent.
  const anchoredCaseIds = cases.filter((c) => c.commitments.length > 0).map((c) => c.id);
  const eventsByCaseId = new Map<string, NormalizedEvent[]>();
  for (const caseIds of chunk(anchoredCaseIds)) {
    const eventRows = await prisma.normalizedEvent.findMany({
      where: { caseId: { in: caseIds } },
      orderBy: [{ caseId: "asc" }, { occurredAt: "asc" }, { sourceSequence: "asc" }],
      // Every field toNormalizedEventDomain reads; createdAt is never needed.
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
    });
    for (const row of eventRows) {
      const domainEvent = toNormalizedEventDomain(row);
      const existing = eventsByCaseId.get(row.caseId);
      if (existing) existing.push(domainEvent);
      else eventsByCaseId.set(row.caseId, [domainEvent]);
    }
  }

  // The persisted Next Reply commitments of every case in scope, in one
  // query per chunk: the plan below is computed in memory, and a transaction
  // is only opened for a case whose commitments actually have to change.
  const existingByCaseId = new Map<string, { id: string; cycleKey: string; status: CommitmentStatus; closedAt: Date | null }[]>();
  for (const caseIds of chunk(anchoredCaseIds)) {
    const rows = await prisma.commitment.findMany({
      where: { caseId: { in: caseIds }, kind: "next_reply" },
      select: { id: true, caseId: true, cycleKey: true, status: true, closedAt: true },
    });
    for (const row of rows) {
      const bucket = existingByCaseId.get(row.caseId);
      if (bucket) bucket.push(row);
      else existingByCaseId.set(row.caseId, [row]);
    }
  }

  for (const caseRow of cases) {
    result.casesConsidered += 1;
    try {
      const anchor = pickAnchorCommitment(caseRow.commitments);
      if (!anchor) continue;

      const anchorPolicyVersion = policyVersionsById.get(anchor.policyVersionId);
      if (!anchorPolicyVersion) throw new Error(`No SLAPolicyVersion loaded for ${anchor.policyVersionId}`);
      const anchorCalendarVersion = calendarsById.get(anchor.calendarVersionId);
      if (!anchorCalendarVersion) throw new Error(`No BusinessCalendarVersion loaded for ${anchor.calendarVersionId}`);

      // Same fallback pipeline.ts uses for a missing sibling kind: prefer the
      // anchor's own frozen policy version if it already targets next_reply,
      // otherwise the newest version of that same policy — still with the
      // anchor's calendar.
      const latestOfSamePolicy =
        activePolicyVersions.find((pv) => pv.policyId === anchorPolicyVersion.policyId) ?? anchorPolicyVersion;
      const policyVersion = anchorPolicyVersion.targets.some((t) => t.kind === "next_reply")
        ? anchorPolicyVersion
        : latestOfSamePolicy;
      const calendarVersion = anchorCalendarVersion;

      const events = eventsByCaseId.get(caseRow.id) ?? [];
      const cycles = policyVersion.targets.some((t) => t.kind === "next_reply")
        ? deriveNextReplyCycles(events, { asOf, firstResponseCompletion: findFirstResponseEvent(events, asOf) })
        : [];

      const plan = planCycleCommitments(existingByCaseId.get(caseRow.id) ?? [], cycles);
      if (plan.create.length === 0 && plan.cancel.length === 0 && plan.restore.length === 0) continue;

      const { created, cancelled, restored } = await persistNextReplyCommitments(prisma, {
        caseId: caseRow.id,
        cycles,
        policyVersion,
        calendarVersion,
        asOf,
      });
      result.cyclesCreated += created;
      result.cyclesCancelled += cancelled;
      result.cyclesRestored += restored;
    } catch (error) {
      result.casesFailed.push({ caseId: caseRow.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}
