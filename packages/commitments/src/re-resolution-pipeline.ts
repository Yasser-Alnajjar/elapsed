import type { PrismaClient } from "@sla/db";
import { createLogger, type Logger } from "@sla/logger";
import {
  computeDeadline,
  matchPolicyVersion,
  resolveCommitmentPolicyChange,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { RE_RESOLUTION_ELIGIBLE_WHERE } from "./active-commitment";
import { latestVersionPerPolicy, resolveCommitmentCalendarVersion, toCaseAttributes } from "./pipeline";
import { toCalendarVersionDomain } from "./calendar-domain";
import { resolveEffectiveCalendarVersion, resolveOrganizationCalendarFallback } from "./calendar-fallback";
import { loadPolicyContext, type PolicyContext } from "./tick-context";

/**
 * The only trigger `runCommitmentReResolutionPipeline` acts on (D1, D1b): a
 * policy-driving Case attribute (priority, customer/organization, tier, or
 * any other field `matchPolicyVersion` reads) changed enough that a
 * genuinely *different* policy now matches. Deliberately generic — never a
 * per-field reason like `priority_changed`.
 *
 * Two triggers the roadmap considered are deliberately *not* reasons this
 * function ever writes, because both were decided "no":
 *  - D1: a new version of the *same* policy (an override, a Zendesk
 *    re-import, or a policy-UI edit) never re-resolves an active commitment
 *    — see `resolveCommitmentPolicyChange`'s `policyId` comparison.
 *  - D1b: a calendar change alone (a customer calendar reassigned, or a
 *    calendar edited) never re-resolves an active commitment either — it
 *    doesn't change which policy matches, so it never reaches this reason.
 */
export const POLICY_SWITCH_REASON = "policy_switched";

export interface CommitmentReResolutionResult {
  casesConsidered: number;
  activeCommitmentsConsidered: number;
  commitmentsUpdated: number;
  /** A case with at least one active commitment whose attributes no longer match any active policy version — left untouched. */
  casesWithNoMatchingPolicy: number;
  /** An active commitment whose newly-matched policy has no target for its kind — left untouched (see module doc comment). */
  commitmentsMissingTarget: number;
  casesFailed: { caseId: string; error: string }[];
}

/**
 * Re-matches every active Commitment in an organization against its Case's
 * *current* attributes, and updates the commitment in place when a
 * different `SLAPolicyVersion` now applies (Active-Commitment
 * Re-Resolution).
 *
 * Deliberately not "if priority changed": the mechanism is generic —
 * `matchPolicyVersion(currentCaseAttributes, activePolicyVersions)` compared
 * against the commitment's stored `policyVersionId` — so a priority,
 * customer/organization, or tier change (or any future match-driving
 * attribute) is handled by the exact same path, with no field-specific
 * branch anywhere in this function. It is also a pure function of current
 * DB state, not of "what changed": running it twice with no intervening
 * change updates nothing and writes no second audit row, and it produces the
 * same result regardless of which trigger (webhook tail, active-set poll,
 * reconciliation sweep, source sync) called it.
 *
 * `startedAt`, `cycleKey`, and the commitment's kind/id never change — only
 * `policyVersionId`, `targetMinutes`, `calendarVersionId`, and the nominal
 * `dueAt` do, so elapsed time keeps being derived from the same event
 * window under the new target (`evaluateCommitment` reads `startedAt` and
 * the event stream, never a stored elapsed counter). A calendar change is
 * applied to the *entire* elapsed window back to the original `startedAt`,
 * not just time going forward — an accepted consequence of "store events,
 * never store computed time": there is no stored "elapsed so far" to freeze
 * under the old calendar.
 *
 * Only commitments that are genuinely active and not yet breached
 * (`RE_RESOLUTION_ELIGIBLE_WHERE` — `closedAt: null`, status not
 * `cancelled` or `breached`; not merely `status === "on_track"`) are
 * candidates — a `met` or terminally-`breached` commitment's policy
 * metadata is immutable, and a `cancelled` commitment's cycle is already
 * gone. A breach is final (D2): a still-open `breached` commitment keeps
 * evaluating (`breachedByMinutes` keeps growing under its already-frozen
 * target), but it is never re-resolved — a later target increase must never
 * turn it back to `on_track`/`at_risk`.
 *
 * If the newly-matched policy has no target for an active commitment's
 * `kind` (e.g. the applicable policy dropped `next_reply`), or no policy
 * matches the case's current attributes at all, that is a configuration
 * issue, not a reason to cancel, delete, or blank out an active SLA
 * commitment: the commitment is left exactly as it is and a warning is
 * logged.
 *
 * Must run after `runCommitmentPipeline` (which creates the commitments this
 * function re-resolves) and before `runNextReplyCyclePipeline`: a Next
 * Reply cycle's anchor policy is read fresh from its case's first-response/
 * resolution commitment on every cycle-pipeline run, so re-resolving that
 * anchor here is what makes a *future* cycle pick up the new policy with no
 * separate mechanism — see `runNextReplyCyclePipeline`'s own doc comment.
 * An already-open Next Reply cycle's own commitment is re-resolved the same
 * way as any other active commitment, through this same function.
 *
 * The commitment id never changes, so `Notification`'s
 * `(commitmentId, threshold)` dedup keeps working unmodified — this
 * function only ever updates a `Commitment` row in place, never cancels or
 * recreates one (Option A, not Option B).
 */
export async function runCommitmentReResolutionPipeline(
  prisma: PrismaClient,
  organizationId: string,
  // `logger` (roadmap 7.4): defaults to a bare logger carrying only
  // organizationId/stage so every caller keeps working, but `cycle.ts`
  // passes one already `.child()`-ed with cycle/integration context so
  // these warnings come out with the same fields as everything else in
  // the cycle they ran in.
  options: {
    asOf?: string;
    logger?: Logger;
    /** Policy/calendar/override reads a worker tick loaded once for all three pipelines. */
    context?: PolicyContext;
    /** Limits the run to these cases (webhook/source-sync). Omit for the whole organization. */
    caseIds?: readonly string[];
  } = {},
): Promise<CommitmentReResolutionResult> {
  const asOf = options.asOf ?? new Date().toISOString();
  const logger = (options.logger ?? createLogger()).child({
    organizationId,
    stage: "commitment_re_resolution",
  });

  const result: CommitmentReResolutionResult = {
    casesConsidered: 0,
    activeCommitmentsConsidered: 0,
    commitmentsUpdated: 0,
    casesWithNoMatchingPolicy: 0,
    commitmentsMissingTarget: 0,
    casesFailed: [],
  };

  const { policyVersionRows, customersWithCalendarOverride } =
    options.context ?? (await loadPolicyContext(prisma, organizationId));
  if (policyVersionRows.length === 0) return result;

  const allPolicyVersions: SLAPolicyVersion[] = policyVersionRows.map((row) => ({
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
    calendarIsExplicit: row.calendarIsExplicit,
  }));
  const activePolicyVersions = latestVersionPerPolicy(allPolicyVersions);

  // Lazy and memoized, same as runCommitmentPipeline: only resolved the
  // first time a re-matched policy actually has no explicit calendar.
  let fallbackPromise: ReturnType<typeof resolveOrganizationCalendarFallback> | null = null;
  const getOrganizationCalendarFallback = () =>
    (fallbackPromise ??= resolveOrganizationCalendarFallback(prisma, organizationId));

  // Which underlying policy each commitment's frozen policyVersionId belongs
  // to (D1) — not just the active/latest versions above, since a commitment
  // may be frozen on an older version of a still-active policy.
  const policyIdByVersionId = new Map<string, string>(policyVersionRows.map((row) => [row.id, row.policyId]));

  const calendarsById = new Map<string, BusinessCalendarVersion>(
    policyVersionRows.map((row) => [row.calendarVersion.id, toCalendarVersionDomain(row.calendarVersion)]),
  );

  // 4d: frozen at the moment the override was set (`Customer.calendarVersionId`), never the calendar's latest version.
  const customerCalendarVersionByCustomerId = new Map<string, BusinessCalendarVersion>();
  for (const customer of customersWithCalendarOverride) {
    if (!customer.calendarVersion) continue;
    customerCalendarVersionByCustomerId.set(customer.id, toCalendarVersionDomain(customer.calendarVersion));
  }

  const cases = await prisma.case.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(options.caseIds ? { id: { in: [...options.caseIds] } } : {}),
      commitments: { some: RE_RESOLUTION_ELIGIBLE_WHERE },
    },
    select: {
      id: true,
      priority: true,
      customerId: true,
      tier: true,
      tags: true,
      channel: true,
      attributes: true,
      openedAt: true,
      commitments: {
        where: RE_RESOLUTION_ELIGIBLE_WHERE,
        select: {
          id: true,
          kind: true,
          policyVersionId: true,
          targetMinutes: true,
          calendarVersionId: true,
          startedAt: true,
        },
      },
    },
  });

  // Calendar versions frozen onto an active commitment that aren't already
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

  // Same for a commitment frozen on a policy version whose policy has since
  // been archived or deactivated entirely — `policyVersionRows` above
  // excludes archived/deactivated policies, but the commitment's own
  // policyId is still needed for the D1 comparison.
  const missingPolicyVersionIds = [
    ...new Set(
      cases.flatMap((c) => c.commitments.map((cm) => cm.policyVersionId).filter((id) => !policyIdByVersionId.has(id))),
    ),
  ];
  if (missingPolicyVersionIds.length > 0) {
    const rows = await prisma.sLAPolicyVersion.findMany({
      where: { id: { in: missingPolicyVersionIds } },
      select: { id: true, policyId: true },
    });
    for (const row of rows) policyIdByVersionId.set(row.id, row.policyId);
  }

  for (const caseRow of cases) {
    result.casesConsidered += 1;
    result.activeCommitmentsConsidered += caseRow.commitments.length;
    try {
      const matched = matchPolicyVersion(toCaseAttributes(caseRow), activePolicyVersions);
      if (!matched) {
        logger.warn("re_resolution_no_matching_policy", {
          caseId: caseRow.id,
          activeCommitmentCount: caseRow.commitments.length,
        });
        result.casesWithNoMatchingPolicy += 1;
        continue;
      }

      const frozenCalendarVersion = calendarsById.get(matched.calendarVersionId);
      if (!frozenCalendarVersion) {
        throw new Error(`No BusinessCalendarVersion loaded for ${matched.calendarVersionId}`);
      }
      // 4i: same explicit-vs-fallback resolution as a brand new commitment —
      // an active commitment moving onto a genuinely different policy
      // (the only case reached here, D1) picks up that policy's calendar
      // exactly as a new commitment matching it right now would. Only a
      // native policy can lack an explicit calendar at all (imported
      // policies always resolve a concrete schedule/default at import time).
      const policyHasExplicitCalendar =
        matched.policySource !== "native" || (matched.calendarIsExplicit ?? true);
      const matchedPolicyCalendarVersion = policyHasExplicitCalendar
        ? frozenCalendarVersion
        : await resolveEffectiveCalendarVersion(
            matched.calendarIsExplicit,
            frozenCalendarVersion,
            await getOrganizationCalendarFallback(),
          );
      const calendarVersion = resolveCommitmentCalendarVersion(
        matchedPolicyCalendarVersion,
        caseRow.customerId ? customerCalendarVersionByCustomerId.get(caseRow.customerId) : undefined,
      );

      for (const commitment of caseRow.commitments) {
        const currentPolicyId = policyIdByVersionId.get(commitment.policyVersionId);
        if (!currentPolicyId) {
          throw new Error(`No SLAPolicyVersion loaded for ${commitment.policyVersionId} (commitment ${commitment.id})`);
        }
        const { changed, hasTarget } = resolveCommitmentPolicyChange(commitment, currentPolicyId, matched);
        if (!changed) continue;

        if (!hasTarget) {
          logger.warn("re_resolution_missing_target", {
            caseId: caseRow.id,
            commitmentId: commitment.id,
            kind: commitment.kind,
            matchedPolicyVersionId: matched.id,
          });
          result.commitmentsMissingTarget += 1;
          continue;
        }

        const target = matched.targets.find((t) => t.kind === commitment.kind)!;
        const dueAt = computeDeadline(commitment.startedAt, target.minutes, calendarVersion);

        // Conditional on the previously-read policyVersionId and on still
        // being active: a concurrent re-resolution (e.g. a webhook and the
        // active-set poll racing on the same commitment) can't apply the
        // same change twice, and the audit row is only written when the
        // update actually lands — the loser's updateMany matches zero rows.
        const updatedCount = await prisma.$transaction(async (tx) => {
          const updated = await tx.commitment.updateMany({
            where: { id: commitment.id, policyVersionId: commitment.policyVersionId, ...RE_RESOLUTION_ELIGIBLE_WHERE },
            data: {
              policyVersionId: matched.id,
              targetMinutes: target.minutes,
              calendarVersionId: calendarVersion.id,
              dueAt,
            },
          });
          if (updated.count > 0) {
            await tx.commitmentPolicyChange.create({
              data: {
                commitmentId: commitment.id,
                previousPolicyVersionId: commitment.policyVersionId,
                newPolicyVersionId: matched.id,
                previousTargetMinutes: commitment.targetMinutes,
                newTargetMinutes: target.minutes,
                previousCalendarVersionId: commitment.calendarVersionId,
                newCalendarVersionId: calendarVersion.id,
                changedAt: new Date(asOf),
                reason: POLICY_SWITCH_REASON,
              },
            });
          }
          return updated.count;
        });
        result.commitmentsUpdated += updatedCount;
      }
    } catch (error) {
      result.casesFailed.push({ caseId: caseRow.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}
