import { CASE_SOURCE_CONNECTED, perfCount, Prisma, type PrismaClient } from "@sla/db";
import {
  assessFreshness,
  evaluateCommitment,
  type BusinessCalendarVersion,
  type Commitment,
  type CommitmentKind,
  type CommitmentStatus,
  type Evaluation,
  type NormalizedEvent,
  type NormalizedEventType,
  type NormalizedState,
  type SLAPolicyMatch,
  type SourceRole,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { ACTIVE_COMMITMENT_WHERE } from "./active-commitment";
import { chunk } from "./tick-context";

export interface CommitmentRecord {
  id: string;
  caseId: string;
  kind: CommitmentKind;
  cycleKey: string;
  policyVersionId: string;
  calendarVersionId: string;
  startedAt: Date;
  targetMinutes: number;
  dueAt: Date;
  status: CommitmentStatus;
  closedAt: Date | null;
}

export interface NormalizedEventRecord {
  id: string;
  caseId: string;
  type: string;
  occurredAt: Date;
  actor: string;
  system: string;
  /** Null only on rows written before N1.5's backfill or by a writer that has not set it yet; the NOT NULL migration follows the writer deploy. */
  sourceRole: string | null;
  fromState: string | null;
  toState: string | null;
  sourceRawEventId: string;
  sourceSequence: number;
}

/** Maps a persisted Commitment row to packages/core's pure `Commitment`. */
export function toCommitmentDomain(row: CommitmentRecord): Commitment {
  return {
    id: row.id,
    caseId: row.caseId,
    kind: row.kind,
    cycleKey: row.cycleKey,
    policyVersionId: row.policyVersionId,
    calendarVersionId: row.calendarVersionId,
    startedAt: row.startedAt.toISOString(),
    targetMinutes: row.targetMinutes,
    dueAt: row.dueAt.toISOString(),
    status: row.status,
    closedAt: row.closedAt?.toISOString(),
  };
}

/** Maps a persisted NormalizedEvent row to packages/core's pure `NormalizedEvent`. */
export function toNormalizedEventDomain(
  row: NormalizedEventRecord,
): NormalizedEvent {
  return {
    id: row.id,
    caseId: row.caseId,
    type: row.type as NormalizedEventType,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actor as NormalizedEvent["actor"],
    system: row.system,
    sourceRole: row.sourceRole as SourceRole,
    fromState: row.fromState as NormalizedState | null,
    toState: row.toState as NormalizedState | null,
    sourceRawEventId: row.sourceRawEventId,
    sourceSequence: row.sourceSequence,
  };
}

/**
 * A Commitment is resolved once it has completed — `evaluation.clock.state`
 * is `stopped`: its first agent reply for first response, the case's close
 * for resolution (`findCompletionEvent` in packages/core). `met` if it
 * completed inside the target, `breached` if not. A `breached` status
 * without completion just means time ran out on a still-open commitment —
 * remaining evaluations must keep running so `breachedByMinutes` keeps
 * growing until it actually completes.
 */
export function isTerminalStatus(
  status: CommitmentStatus,
  completed: boolean,
): boolean {
  if (status === "met") return true;
  if (status === "breached") return completed;
  return false;
}

/**
 * An Evaluation is a snapshot worth keeping, not a heartbeat. `remainingMinutes`
 * is recomputable at any moment from the event stream (the schema's "store
 * events, never store computed time" rule), so a poll that finds nothing
 * changed writes nothing — otherwise every open commitment would accrue a row
 * every five minutes forever. What gets persisted is what later has to be
 * explained: the first evaluation, every status transition (the trigger
 * notifications key off in Phase 13.7), and the final snapshot recording the
 * magnitude a commitment ended up meeting or breaching by.
 */
export function shouldPersistEvaluation(
  status: CommitmentStatus,
  previousStatus: CommitmentStatus | null,
  terminal: boolean,
  alreadyFinalized: boolean,
): boolean {
  if (previousStatus === null) return true;
  if (status !== previousStatus) return true;
  return terminal && !alreadyFinalized;
}

/**
 * Whether this evaluation can raise a new alert. A commitment that was
 * already finalized before this evaluation and is still terminal after it is
 * history: the reconciliation sweep may correct its status (e.g. a clock-rule
 * fix turning `met` into `breached`), and that correction is persisted, but
 * nobody can act on a breach that ended in the past — so it never becomes a
 * notification candidate. A finalized commitment that is live again (its case
 * was reopened) alerts as usual.
 *
 * Trade-off: a breach alert whose every channel failed in the cycle that
 * finalized the commitment is no longer retried by the hourly sweep.
 */
export function canRaiseAlert(
  alreadyFinalized: boolean,
  terminal: boolean,
): boolean {
  return !(alreadyFinalized && terminal);
}

/**
 * The provider's own id for each RawEvent an evaluation's `lastEvent` was
 * derived from (e.g. `ticket_audit:39016977009682`), so a persisted snapshot
 * names its source in the provider's terms too, not only by RawEvent row id.
 */
async function loadProviderEventIds(
  prisma: PrismaClient,
  evaluations: Evaluation[],
): Promise<Map<string, string>> {
  const rawEventIds = [
    ...new Set(
      evaluations.flatMap((e) =>
        e.inputs.lastEvent ? [e.inputs.lastEvent.sourceRawEventId] : [],
      ),
    ),
  ];
  if (rawEventIds.length === 0) return new Map();
  const rows = await prisma.rawEvent.findMany({
    where: { id: { in: rawEventIds } },
    select: { id: true, providerEventId: true },
  });
  return new Map(rows.map((row) => [row.id, row.providerEventId]));
}

/**
 * Maps an `evaluateCommitment` result onto an `evaluations` row: whole
 * seconds for durations (never truncated minutes), and `inputs.lastEvent` as
 * the stable source-event reference plus its provider event id when known.
 * `breachedAt` is the row's copy of `evaluation.effectiveDueAt` — the actual
 * SLA-clock-crossing instant — persisted only when `status === "breached"`;
 * `effectiveDueAt` is also used for a live *projected* deadline on a
 * still-running commitment, which is not a breach instant and must never
 * land in this column. `evaluatedAt` stays what it always was: when this
 * evaluation ran, not when the breach happened.
 */
export function toEvaluationCreateInput(
  evaluation: Evaluation,
  providerEventIdByRawEventId: Map<string, string> = new Map(),
  sourceStaleSince: string | null = null,
): Prisma.EvaluationCreateManyInput {
  const { lastEvent } = evaluation.inputs;
  const inputs = {
    ...evaluation.inputs,
    lastEvent: lastEvent
      ? {
          ...lastEvent,
          providerEventId:
            providerEventIdByRawEventId.get(lastEvent.sourceRawEventId) ?? null,
        }
      : null,
  };
  return {
    id: evaluation.id,
    commitmentId: evaluation.commitmentId,
    evaluatedAt: new Date(evaluation.evaluatedAt),
    elapsedSeconds: evaluation.elapsedSeconds,
    remainingSeconds: evaluation.remainingSeconds,
    status: evaluation.status,
    breachedBySeconds: evaluation.breachedBySeconds ?? null,
    breachedAt:
      evaluation.status === "breached" && evaluation.effectiveDueAt
        ? new Date(evaluation.effectiveDueAt)
        : null,
    inputs: inputs as unknown as Prisma.InputJsonValue,
    sourceStaleSince: sourceStaleSince ? new Date(sourceStaleSince) : null,
  };
}

/**
 * Every field `toNormalizedEventDomain` reads — deliberately not the whole
 * row (`createdAt` is never needed), since this is the widest read in the
 * tick.
 */
const EVENT_SELECT = {
  id: true,
  caseId: true,
  type: true,
  occurredAt: true,
  actor: true,
  system: true,
  sourceRole: true,
  fromState: true,
  toState: true,
  sourceRawEventId: true,
  sourceSequence: true,
} as const;

/** Events for `caseIds`, `IN` list chunked so it's never one enormous parameter list. Ordered per case as the engine expects. */
export async function loadEventsForCases(prisma: PrismaClient, caseIds: readonly string[]) {
  const rows: NormalizedEventRecord[] = [];
  for (const ids of chunk(caseIds)) {
    rows.push(
      ...(await prisma.normalizedEvent.findMany({
        where: { caseId: { in: ids } },
        orderBy: [{ caseId: "asc" }, { occurredAt: "asc" }, { sourceSequence: "asc" }],
        select: EVENT_SELECT,
      })),
    );
  }
  return rows;
}

/**
 * The status of each commitment's most recent persisted evaluation, via
 * `DISTINCT ON` in Postgres. Prisma's own `distinct` option de-duplicates
 * client-side, i.e. it would read every evaluation row ever written for
 * every commitment in scope and throw all but one away. `id DESC` breaks an
 * `evaluatedAt` tie deterministically.
 */
async function loadLatestEvaluationStatuses(
  prisma: PrismaClient,
  commitmentIds: readonly string[],
): Promise<{ commitmentId: string; status: CommitmentStatus }[]> {
  const rows: { commitmentId: string; status: CommitmentStatus }[] = [];
  for (const ids of chunk(commitmentIds)) {
    rows.push(
      ...(await prisma.$queryRaw<{ commitmentId: string; status: CommitmentStatus }[]>(Prisma.sql`
        SELECT DISTINCT ON ("commitmentId") "commitmentId", "status"
        FROM "evaluations"
        WHERE "commitmentId" IN (${Prisma.join(ids)})
        ORDER BY "commitmentId", "evaluatedAt" DESC, "id" DESC
      `)),
    );
  }
  return rows;
}

interface CommitmentUpdate {
  id: string;
  policyVersionId: string;
  status: CommitmentStatus;
  closedAt: string | null;
}

/**
 * Applies status/closedAt changes as one `UPDATE … FROM (VALUES …)` per
 * chunk instead of one `updateMany` per commitment. The compare-and-set
 * conditions (E-2) are unchanged and evaluated per row inside the join: a
 * concurrent cancellation or re-resolution onto a different policy version
 * between the read and this write must never be clobbered by a status/
 * closedAt computed from the stale row.
 *
 * `closedAt` goes in as an ISO string (always UTC, from `toISOString()`) and
 * is converted with `AT TIME ZONE 'UTC'` because the column is a plain
 * `timestamp(3)` — casting straight to `timestamp` would depend on the
 * session time zone.
 */
async function applyCommitmentUpdates(prisma: PrismaClient, updates: readonly CommitmentUpdate[]) {
  for (const batch of chunk(updates)) {
    const values = Prisma.join(
      batch.map(
        (u) =>
          Prisma.sql`(${u.id}, ${u.policyVersionId}, ${u.status}, ${u.closedAt}::text)`,
      ),
    );
    await prisma.$executeRaw`
      UPDATE "commitments" AS c
      SET "status" = v."status"::"CommitmentStatus",
          "closedAt" = CASE WHEN v."closedAt" IS NULL THEN NULL
                            ELSE (v."closedAt"::timestamptz AT TIME ZONE 'UTC') END
      FROM (VALUES ${values}) AS v("id", "policyVersionId", "status", "closedAt")
      WHERE c."id" = v."id"
        AND c."policyVersionId" = v."policyVersionId"
        AND c."status" <> 'cancelled'
    `;
  }
}

export type EvaluationScope = "active" | "all";

/**
 * A commitment whose evaluation this cycle crossed a `warnAtPercent`
 * threshold or breached (Phase 13.7). Deliberately collected for every
 * commitment evaluated, not only ones that get a persisted `Evaluation` row
 * (see `shouldPersistEvaluation`): a commitment can sit in `at_risk` for many
 * cycles while `warnThresholdCrossed` climbs 50 -> 80 -> 95 without its
 * coarse status ever changing, and each of those crossings is a distinct,
 * meaningful notification. Actual dedup against `(commitmentId, threshold)`
 * happens downstream, in @sla/notifications, via the `Notification` table's
 * unique constraint — this list is candidates, not guaranteed-new alerts.
 * Commitments that were already finalized and stay terminal never become
 * candidates (`canRaiseAlert`).
 */
export interface NotificationCandidate {
  commitmentId: string;
  caseId: string;
  kind: CommitmentKind;
  status: CommitmentStatus;
  threshold: number;
  remainingMinutes: number;
  breachedByMinutes?: number;
  /** The matched policy's own name (`SLAPolicy.name`) — 3.9's alert context. */
  policyName: string;
  targetMinutes: number;
  startedAt: string; // ISO 8601
  /**
   * The exact breach instant (`Evaluation.effectiveDueAt`) when this
   * candidate's threshold is the breach one — null while still at_risk. 3.9's
   * alert context: "start and breach times".
   */
  breachedAt?: string | null;
  /** Metadata only: lets dispatch caveat at-risk alerts and hold breach alerts. */
  sourceStaleSince?: string | null;
}

export interface EvaluationPipelineResult {
  commitmentsConsidered: number;
  evaluationsCreated: number;
  commitmentsFinalized: number;
  commitmentsFailed: { commitmentId: string; error: string }[];
  notificationCandidates: NotificationCandidate[];
}

/**
 * Evaluates every Commitment in scope for an organization and persists the
 * resulting Evaluations (Phase 16: each poll cycle calls `evaluateCommitment`
 * and writes `Evaluation` rows). `scope: "active"` is the 5-minute
 * active-set poll — only commitments not yet finalized (`closedAt: null`).
 * `scope: "all"` is the 60-minute reconciliation sweep — re-checks every
 * commitment, including already-finalized ones, as a safety net against a
 * missed or failed active-set cycle. Neither scope includes a `cancelled`
 * commitment — its cycle no longer exists (`persistNextReplyCommitments`), so
 * there is nothing to measure. Only meaningful evaluations are written
 * (see `shouldPersistEvaluation`), and an Evaluation's id is a deterministic
 * hash of its inputs, so a re-run at the same `asOf` writes nothing twice.
 *
 * Covers every `CommitmentKind`, including `next_reply`: `evaluateCommitment`
 * matches a persisted Next Reply commitment to its derived cycle by
 * `commitment.cycleKey` (`findCompletionEvent` in packages/core), so a live
 * cycle created by `runNextReplyCyclePipeline` (cycle-pipeline.ts) is
 * evaluated the same way as first_response/resolution.
 */
export async function runEvaluationPipeline(
  prisma: PrismaClient,
  organizationId: string,
  options: {
    asOf?: string;
    scope?: EvaluationScope;
    /** Limits the run to these cases (webhook/source-sync: only the cases the delivery touched). Omit for the whole organization. */
    caseIds?: readonly string[];
    /** Active poll cadence and its operator-set grace multiplier. */
    freshness?: { expectedIntervalMs: number; graceFactor?: number };
  } = {},
): Promise<EvaluationPipelineResult> {
  const asOf = options.asOf ?? new Date().toISOString();
  const scope = options.scope ?? "active";

  const result: EvaluationPipelineResult = {
    commitmentsConsidered: 0,
    evaluationsCreated: 0,
    commitmentsFinalized: 0,
    commitmentsFailed: [],
    notificationCandidates: [],
  };

  const commitmentRows = await prisma.commitment.findMany({
    where: {
      case: {
        organizationId,
        deletedAt: null,
        // A disconnected source's cases are not evaluated, so they raise no
        // alerts; reconnecting resumes evaluation of the same commitments.
        ...CASE_SOURCE_CONNECTED,
        ...(options.caseIds ? { id: { in: [...options.caseIds] } } : {}),
      },
      // "all" (the reconciliation sweep) still excludes cancelled commitments
      // — their cycle no longer exists — but otherwise re-checks every
      // commitment, finalized or not; "active" narrows to the shared
      // ACTIVE_COMMITMENT_WHERE definition.
      ...(scope === "active"
        ? ACTIVE_COMMITMENT_WHERE
        : { status: { not: "cancelled" } }),
    },
  });
  result.commitmentsConsidered = commitmentRows.length;
  if (commitmentRows.length === 0) return result;

  const policyVersionIds = [
    ...new Set(commitmentRows.map((c) => c.policyVersionId)),
  ];
  const calendarVersionIds = [
    ...new Set(commitmentRows.map((c) => c.calendarVersionId)),
  ];
  const caseIds = [...new Set(commitmentRows.map((c) => c.caseId))];

  const [policyVersionRows, calendarVersionRows, eventRows, latestEvaluationRows, caseRows, integrationRows] =
    await Promise.all([
      prisma.sLAPolicyVersion.findMany({
        where: { id: { in: policyVersionIds } },
        include: { policy: { select: { name: true } } },
      }),
      prisma.businessCalendarVersion.findMany({
        where: { id: { in: calendarVersionIds } },
      }),
      loadEventsForCases(prisma, caseIds),
      loadLatestEvaluationStatuses(
        prisma,
        commitmentRows.map((c) => c.id),
      ),
      prisma.case.findMany({
        where: { id: { in: caseIds } },
        select: {
          id: true,
          sourceIntegrationId: true,
          caseLinks: { where: { confidence: "certain", unlinkedAt: null }, select: { system: true } },
        },
      }),
      prisma.integration.findMany({
        where: { organizationId },
        select: { id: true, provider: true, lastSuccessfulSyncAt: true },
      }),
    ]);

  const caseById = new Map(caseRows.map((row) => [row.id, row]));
  const integrationById = new Map(integrationRows.map((row) => [row.id, row]));
  const integrationByProvider = new Map(integrationRows.map((row) => [row.provider, row]));
  const freshness = options.freshness ?? { expectedIntervalMs: 5 * 60_000, graceFactor: 3 };
  const staleSinceForCase = (caseId: string): string | null => {
    const caseRow = caseById.get(caseId);
    if (!caseRow) return null;
    const source = caseRow.sourceIntegrationId ? integrationById.get(caseRow.sourceIntegrationId) : undefined;
    const related = [source, ...caseRow.caseLinks.map((link) => integrationByProvider.get(link.system))].filter(
      (value): value is NonNullable<typeof value> => Boolean(value),
    );
    const stale = related.map((integration) => assessFreshness({
      lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt,
      asOf,
      expectedIntervalMs: freshness.expectedIntervalMs,
      graceFactor: freshness.graceFactor,
    }).staleSince).filter((value): value is string => value !== null);
    return stale.length === 0 ? null : stale.sort()[0]!;
  };

  const previousStatusByCommitmentId = new Map<string, CommitmentStatus>(
    latestEvaluationRows.map((row) => [row.commitmentId, row.status]),
  );

  const policyVersionsById = new Map<string, SLAPolicyVersion>(
    policyVersionRows.map((row) => [
      row.id,
      {
        id: row.id,
        policyId: row.policyId,
        version: row.version,
        match: row.match as SLAPolicyMatch,
        targets: row.targets as { kind: CommitmentKind; minutes: number }[],
        pauseOnStates: row.pauseOnStates as NormalizedState[],
        calendarVersionId: row.calendarVersionId,
        warnAtPercent: row.warnAtPercent,
        effectiveFrom: row.effectiveFrom.toISOString(),
      },
    ]),
  );

  // 3.9's alert context — the policy name a version carries no field of its own.
  const policyNameByVersionId = new Map<string, string>(
    policyVersionRows.map((row) => [row.id, row.policy.name]),
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

  const evaluationsToCreate: Evaluation[] = [];
  const commitmentUpdates: CommitmentUpdate[] = [];

  for (const row of commitmentRows) {
    try {
      const policyVersion = policyVersionsById.get(row.policyVersionId);
      if (!policyVersion)
        throw new Error(
          `No SLAPolicyVersion loaded for ${row.policyVersionId}`,
        );
      const calendarVersion = calendarsById.get(row.calendarVersionId);
      if (!calendarVersion)
        throw new Error(
          `No BusinessCalendarVersion loaded for ${row.calendarVersionId}`,
        );

      const caseEvents = eventsByCaseId.get(row.caseId) ?? [];
      const sourceStaleSince = staleSinceForCase(row.caseId);
      const commitment = toCommitmentDomain(row);
      const evaluation = evaluateCommitment(
        commitment,
        caseEvents,
        policyVersion,
        calendarVersion,
        asOf,
      );
      perfCount("evaluateCommitment");

      const terminal = isTerminalStatus(
        evaluation.status,
        evaluation.clock.state === "stopped",
      );
      const finalized = row.closedAt !== null;

      if (
        evaluation.warnThresholdCrossed !== undefined &&
        canRaiseAlert(finalized, terminal) &&
        // D13(b): a breach based on stale source data is held. At-risk
        // alerts still reach the team, explicitly caveated by the dispatcher.
        !(sourceStaleSince && evaluation.warnThresholdCrossed === 100)
      ) {
        result.notificationCandidates.push({
          commitmentId: row.id,
          caseId: row.caseId,
          kind: row.kind,
          status: evaluation.status,
          threshold: evaluation.warnThresholdCrossed,
          remainingMinutes: evaluation.remainingMinutes,
          breachedByMinutes: evaluation.breachedByMinutes,
          policyName:
            policyNameByVersionId.get(row.policyVersionId) ?? "Unknown policy",
          targetMinutes: row.targetMinutes,
          startedAt: row.startedAt.toISOString(),
          breachedAt:
            evaluation.status === "breached" ? evaluation.effectiveDueAt : null,
          sourceStaleSince,
        });
      }

      if (
        shouldPersistEvaluation(
          evaluation.status,
          previousStatusByCommitmentId.get(row.id) ?? null,
          terminal,
          finalized,
        )
      ) {
        evaluationsToCreate.push(Object.assign(evaluation, { sourceStaleSince }));
      }

      // A finalized commitment keeps its original closedAt when a later
      // evaluation revises its status, and loses it when it is no longer
      // terminal (its case was reopened), so the active-set poll picks it
      // back up instead of leaving it to the hourly reconciliation sweep.
      if (evaluation.status !== row.status || terminal !== finalized) {
        commitmentUpdates.push({
          id: row.id,
          policyVersionId: row.policyVersionId,
          status: evaluation.status,
          closedAt: terminal
            ? (row.closedAt?.toISOString() ?? evaluation.evaluatedAt)
            : null,
        });
        if (terminal && !finalized) result.commitmentsFinalized += 1;
      }
    } catch (error) {
      result.commitmentsFailed.push({
        commitmentId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (evaluationsToCreate.length > 0) {
    const providerEventIdByRawEventId = await loadProviderEventIds(
      prisma,
      evaluationsToCreate,
    );
    const created = await prisma.evaluation.createMany({
      data: evaluationsToCreate.map((evaluation) =>
        toEvaluationCreateInput(evaluation, providerEventIdByRawEventId, (evaluation as Evaluation & { sourceStaleSince?: string | null }).sourceStaleSince),
      ),
      skipDuplicates: true,
    });
    result.evaluationsCreated = created.count;
  }

  await applyCommitmentUpdates(prisma, commitmentUpdates);

  return result;
}
