import { getWorkerSettingsForRead, perfCount, withPerfScope, type IntegrationProvider, type PrismaClient } from "@sla/db";
import {
  BREACH_NOTIFICATION_THRESHOLD,
  assessFreshness,
  sortNormalizedEvents,
  computeElapsedWorkingMinutes,
  deriveLegSpans,
  evaluateCommitment,
  evaluateEngineeringLegTarget,
  eventsForPauseFold,
  pauseStatesFor,
  sumLegMinutes,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type EngineeringLegEvaluation,
  type Leg,
  type NormalizedEvent,
  type NormalizedState,
  type PausedInterval,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { toCommitmentDomain, toNormalizedEventDomain } from "@sla/commitments";
import type { ConversationEventRef } from "@sla/ingestion";
import { WEB_PROVIDERS, externalUrlFor, isIssueLinkSystem } from "@/lib/providers";
import type {
  CaseDetailData,
  CaseLinkDetail,
  CommitmentDetail,
  ConversationMessageDetail,
  LegTotal,
  TimelineEventDetail,
} from "./types/cases";

// Every field this module actually reads off an `Integration` row: `provider`
// (to pick the adapter), `id` (only to pass along to
// `buildConversationMessages`) and `credentials` (handed to the adapter's
// `externalUrl`) — never the row's other columns.
const INTEGRATION_SELECT = { id: true, provider: true, credentials: true, lastSuccessfulSyncAt: true } as const;

// No business calendar exists yet for a case whose SLA hasn't matched any
// policy — fall back to an always-open calendar purely for the purpose of
// rendering the working/paused overlay (which does not actually depend on
// working-hours math, only on the pause-state event stream).
const FALLBACK_CALENDAR: BusinessCalendarVersion = {
  id: "none",
  version: 0,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};

/**
 * Deterministic display order for a case's commitments — first response,
 * then every Next Reply cycle, then resolution — independent of the
 * unordered `commitments: true` include above (`Record<CommitmentKind, …>`
 * so a future kind fails to compile here until it's placed).
 */
const COMMITMENT_KIND_DISPLAY_ORDER: Record<CommitmentKind, number> = {
  first_response: 0,
  next_reply: 1,
  resolution: 2,
};

function complementIntervals(
  pausedIntervals: PausedInterval[],
  start: string,
  end: string,
): { start: string; end: string }[] {
  const sorted = [...pausedIntervals].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  const running: { start: string; end: string }[] = [];
  let cursor = start;
  for (const p of sorted) {
    if (p.start > cursor) running.push({ start: cursor, end: p.start });
    if (p.end > cursor) cursor = p.end;
  }
  if (end > cursor) running.push({ start: cursor, end });
  return running;
}

/**
 * Assembles everything the case detail page (roadmap step 10) needs: the
 * header, both commitments with the policy/calendar that produced their
 * numbers (the "how this was calculated" disclosure), the leg timeline with
 * working/paused shading, and outbound links to both source systems.
 *
 * Returns null when the case doesn't exist or belongs to a different
 * organization — the caller renders a 404 either way, so no distinction is
 * made between the two.
 */
export async function getCaseDetailData(
  prisma: PrismaClient,
  organizationId: string,
  caseId: string,
  asOfDate: Date = new Date(),
): Promise<CaseDetailData | null> {
  return withPerfScope(
    "case_detail",
    () => getCaseDetailDataInner(prisma, organizationId, caseId, asOfDate),
    { organizationId, caseId },
  );
}

async function getCaseDetailDataInner(
  prisma: PrismaClient,
  organizationId: string,
  caseId: string,
  asOfDate: Date,
): Promise<CaseDetailData | null> {
  const asOf = asOfDate.toISOString();

  // Round 1: `caseRow` and the four queries below only ever need `caseId`/
  // `organizationId` — none of them read `caseRow`'s output — so they run
  // in the same round instead of waiting on `caseRow` first. The rare
  // not-found case pays for events/integrations/organization it won't use;
  // the common case (the case exists) saves a full round trip.
  const [caseRow, eventRows, integrationRows, organization] = await Promise.all([
    prisma.case.findFirst({
      where: { id: caseId, organizationId, deletedAt: null },
      include: { customer: true, caseLinks: true, commitments: true },
    }),
    prisma.normalizedEvent.findMany({
      where: { caseId },
      orderBy: [{ occurredAt: "asc" }, { sourceSequence: "asc" }],
    }),
    prisma.integration.findMany({
      where: { organizationId },
      select: INTEGRATION_SELECT,
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { engineeringLegTargetMinutes: true },
    }),
  ]);
  if (!caseRow) return null;

  const policyVersionIds = [
    ...new Set(caseRow.commitments.map((c) => c.policyVersionId)),
  ];
  const calendarVersionIds = [
    ...new Set(caseRow.commitments.map((c) => c.calendarVersionId)),
  ];
  const commitmentIds = caseRow.commitments.map((c) => c.id);
  const commitmentKindById = new Map(
    caseRow.commitments.map((c) => [c.id, c.kind]),
  );

  // The engine's own total order, so the timeline lists same-instant events
  // exactly as the evaluations below consumed them. Computed here (ahead of
  // round 2) since `buildConversationMessages` below needs it.
  const domainEvents: NormalizedEvent[] = sortNormalizedEvents(
    eventRows.map(toNormalizedEventDomain),
  );

  // Round 2: policy/calendar/history rows (depend on `caseRow.commitments`)
  // and `buildConversationMessages` (depends on `caseRow`/`domainEvents`/
  // the case's source integration, not on this round's other three queries)
  // run together — neither needs the other's result.
  const integrationOf = (provider: IntegrationProvider) => integrationRows.find((row) => row.provider === provider);
  const [
    policyVersionRows,
    calendarVersionRows,
    policyChangeRows,
    notificationRows,
    conversation,
  ] = await Promise.all([
    policyVersionIds.length > 0
      ? prisma.sLAPolicyVersion.findMany({
          where: { id: { in: policyVersionIds } },
          include: { policy: { select: { name: true } } },
        })
      : Promise.resolve([]),
    calendarVersionIds.length > 0
      ? prisma.businessCalendarVersion.findMany({
          where: { id: { in: calendarVersionIds } },
        })
      : Promise.resolve([]),
    // 3.4's target-change history — every Active-Commitment Re-Resolution
    // that changed one of this case's commitments in place. `in: []` is a
    // safe no-op query (a case with no commitments yet), not worth a
    // separate empty-array branch.
    prisma.commitmentPolicyChange.findMany({
      where: { commitmentId: { in: commitmentIds } },
      orderBy: { changedAt: "asc" },
    }),
    // 3.3's "at-risk threshold crossed" markers — the exact instant each
    // warn threshold was first detected, already persisted for alerting
    // (Phase 13.7). The breach threshold (100) is excluded: 3.3 shows that
    // as its own "breached" marker, from the live evaluation's
    // `effectiveDueAt`, not from this table.
    prisma.notification.findMany({
      where: {
        commitmentId: { in: commitmentIds },
        threshold: { not: BREACH_NOTIFICATION_THRESHOLD },
      },
      orderBy: { sentAt: "asc" },
    }),
    // Presentation-only: reads each reply's source text out of RawEvent,
    // never altering `domainEvents` or anything derived from it.
    buildConversationMessages(
      prisma,
      caseRow,
      domainEvents,
      integrationOf(caseRow.system)?.id ?? null,
    ),
  ]);

  const policyChangesByCommitmentId = new Map<
    string,
    typeof policyChangeRows
  >();
  for (const row of policyChangeRows) {
    const list = policyChangesByCommitmentId.get(row.commitmentId);
    if (list) list.push(row);
    else policyChangesByCommitmentId.set(row.commitmentId, [row]);
  }

  const notificationsByCommitmentId = new Map<
    string,
    typeof notificationRows
  >();
  for (const row of notificationRows) {
    const list = notificationsByCommitmentId.get(row.commitmentId);
    if (list) list.push(row);
    else notificationsByCommitmentId.set(row.commitmentId, [row]);
  }

  const policyNameByVersionId = new Map<string, string>(
    policyVersionRows.map((row) => [row.id, row.policy.name]),
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
        calendarIsExplicit: row.calendarIsExplicit,
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

  const commitments: CommitmentDetail[] = caseRow.commitments
    .map((row): CommitmentDetail | null => {
      const policyVersion = policyVersionsById.get(row.policyVersionId);
      const calendarRow = calendarVersionRows.find(
        (c) => c.id === row.calendarVersionId,
      );
      const calendar = calendarsById.get(row.calendarVersionId);
      if (!policyVersion || !calendarRow || !calendar) return null;

      // A cancelled commitment is a finalized lifecycle state (Step 6) that
      // evaluateCommitment can't express — it only ever returns on_track |
      // at_risk | met | breached, since it has no notion of a cycle having
      // been superseded or disappeared. The persisted `status` column is the
      // source of truth for that, so it — not the live evaluation — decides
      // the displayed status here, generically for every commitment kind.
      // The clock is still evaluated, but frozen at the cancellation instant
      // (`closedAt`) rather than the live `asOf`, so a cancelled cycle's
      // elapsed/remaining numbers reflect its state at cancellation instead
      // of continuing to run against events that no longer apply to it.
      const isCancelled = row.status === "cancelled";
      const evaluation = evaluateCommitment(
        toCommitmentDomain(row),
        domainEvents,
        policyVersion,
        calendar,
        isCancelled ? (row.closedAt?.toISOString() ?? asOf) : asOf,
      );
      perfCount("evaluateCommitment");

      return {
        id: row.id,
        kind: row.kind,
        cycleKey: row.cycleKey,
        status: isCancelled ? "cancelled" : evaluation.status,
        startedAt: row.startedAt.toISOString(),
        targetMinutes: row.targetMinutes,
        closedAt: row.closedAt?.toISOString() ?? null,
        elapsedSeconds: evaluation.elapsedSeconds,
        remainingSeconds: evaluation.remainingSeconds,
        breachedBySeconds: isCancelled
          ? null
          : (evaluation.breachedBySeconds ?? null),
        clockState: isCancelled ? "stopped" : evaluation.clock.state,
        pausedSince: isCancelled ? null : evaluation.clock.pausedSince,
        effectiveDueAt: isCancelled ? null : evaluation.effectiveDueAt,
        pauseOnStates: pauseStatesFor(row.kind, policyVersion),
        policyVersion: {
          id: policyVersion.id,
          name: policyNameByVersionId.get(policyVersion.id) ?? "Unknown policy",
          version: policyVersion.version,
          match: policyVersion.match,
          warnAtPercent: policyVersion.warnAtPercent,
          effectiveFrom: policyVersion.effectiveFrom,
        },
        calendar: {
          id: calendar.id,
          version: calendarRow.version,
          timezone: calendar.timezone,
          weekly: calendar.weekly,
          holidays: calendar.holidays,
          alwaysOpen: calendar.alwaysOpen,
          // Resolution precedence (4i): a customer's calendar override wins
          // first (its own frozen `calendarVersionId`, `Customer.calendarId`
          // set via setCustomerCalendar); otherwise the policy's own
          // calendar — either its explicit pin (frozen `calendarVersionId`
          // matches) or, for a native policy with none, whatever the
          // organization's default (or Always Open) resolved to at
          // commitment-creation time, which won't match the policy
          // version's own stale snapshot.
          source:
            caseRow.customer?.calendarVersionId &&
            row.calendarVersionId === caseRow.customer.calendarVersionId
              ? "customer_override"
              : row.calendarVersionId === policyVersion.calendarVersionId
                ? "policy"
                : "organization_default",
        },
        // The completing event's own occurredAt (3.3's "met" marker) — only
        // meaningful once the clock has actually stopped; a cancelled
        // commitment's clock is forced to "stopped" above but never
        // completed, so it's excluded too.
        completionOccurredAt:
          !isCancelled && evaluation.clock.state === "stopped"
            ? (evaluation.inputs.lastEvent?.occurredAt ?? null)
            : null,
        targetChangeHistory: (
          policyChangesByCommitmentId.get(row.id) ?? []
        ).map((change) => ({
          changedAt: change.changedAt.toISOString(),
          previousTargetMinutes: change.previousTargetMinutes,
          newTargetMinutes: change.newTargetMinutes,
          reason: change.reason,
        })),
      };
    })
    .filter((c): c is CommitmentDetail => c !== null)
    .sort((a, b) => {
      const kindOrder =
        COMMITMENT_KIND_DISPLAY_ORDER[a.kind] -
        COMMITMENT_KIND_DISPLAY_ORDER[b.kind];
      if (kindOrder !== 0) return kindOrder;
      // Only next_reply ever has more than one commitment per case — its
      // cycles order chronologically by their own anchor (startedAt), never
      // by whatever order the DB happened to return them in.
      return a.startedAt.localeCompare(b.startedAt);
    });

  const endBound = caseRow.closedAt?.toISOString() ?? asOf;

  const { spans } = deriveLegSpans(domainEvents, {
    caseOpenedAt: caseRow.openedAt.toISOString(),
  });
  perfCount("deriveLegSpans");
  const legSpans = spans.map((s) => ({ ...s, endedAt: s.endedAt ?? endBound }));
  const currentLeg: Leg = legSpans[legSpans.length - 1]?.leg ?? "unknown";

  const legTotalsByLeg = new Map<Leg, number>();
  for (const s of legSpans) {
    const minutes =
      (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) /
      60_000;
    legTotalsByLeg.set(s.leg, (legTotalsByLeg.get(s.leg) ?? 0) + minutes);
  }
  const LEG_ORDER: Leg[] = [
    "support",
    "engineering",
    "waiting_customer",
    "unknown",
  ];
  const legTotals: LegTotal[] = LEG_ORDER.filter((leg) =>
    legTotalsByLeg.has(leg),
  ).map((leg) => ({
    leg,
    minutes: legTotalsByLeg.get(leg)!,
  }));

  const engineeringLegTargetMinutes =
    organization?.engineeringLegTargetMinutes ?? null;
  const engineeringLegTarget: EngineeringLegEvaluation | null =
    engineeringLegTargetMinutes !== null
      ? evaluateEngineeringLegTarget(
          sumLegMinutes(spans, "engineering", endBound),
          engineeringLegTargetMinutes,
          currentLeg === "engineering",
        )
      : null;

  // The timeline's working/paused shading spans the whole case, so it
  // follows the resolution commitment (the one that runs until close) when
  // the case has one, not whichever commitment happens to sort first — and
  // that commitment's own pause states, since kinds pause differently.
  const shadingCommitment =
    commitments.find((c) => c.kind === "resolution") ?? commitments[0];
  const pauseOnStates = shadingCommitment?.pauseOnStates ?? [];
  const pauseCalendar = shadingCommitment
    ? calendarsById.get(shadingCommitment.calendar.id)!
    : FALLBACK_CALENDAR;
  // Both the pauses and their complement cover the same window — the
  // timeline's own span, from the case's open to its end bound — so a linked
  // issue's events from before the case can't shade time before it opened.
  const shadingWindow = {
    start: caseRow.openedAt.toISOString(),
    end: endBound,
  };
  const { pausedIntervals } = computeElapsedWorkingMinutes(
    shadingCommitment
      ? eventsForPauseFold(shadingCommitment.kind, domainEvents)
      : domainEvents,
    pauseOnStates,
    pauseCalendar,
    shadingWindow,
  );
  const runningIntervals = complementIntervals(
    pausedIntervals,
    shadingWindow.start,
    shadingWindow.end,
  );

  // The case's own provider decides its outbound link (roadmap step 22), not
  // just "is a ticket source connected": an org with two ticket sources
  // connected must never build one's link for the other's case, whose
  // externalId was never that source's id. A source whose link needs data it
  // has not recorded yet (Intercom's workspace id, from the first sync after
  // connecting) has none until then.
  const ticketUrl = externalUrlFor(caseRow.system, {
    externalId: caseRow.externalId,
    credentials: integrationOf(caseRow.system)?.credentials,
  });
  const sourceIntegration = caseRow.sourceIntegrationId
    ? integrationRows.find((row) => row.id === caseRow.sourceIntegrationId)
    : integrationOf(caseRow.system);
  const workerSettings = sourceIntegration ? await getWorkerSettingsForRead(prisma) : null;
  const sourceFreshness = sourceIntegration && workerSettings
    ? assessFreshness({
        lastSuccessfulSyncAt: sourceIntegration.lastSuccessfulSyncAt,
        asOf,
        expectedIntervalMs: workerSettings.activePollIntervalMs,
        graceFactor: workerSettings.freshnessGraceFactor,
      })
    : null;
  const sourceNeverSynced = !!sourceFreshness && !sourceFreshness.fresh && !sourceIntegration?.lastSuccessfulSyncAt;
  const sourceStaleSince = sourceNeverSynced ? null : (sourceFreshness?.staleSince ?? null);

  // Every CaseLink system this page renders: the issue and pull-request
  // providers (by their registry role). Excludes a link whose `unlinkedAt` is
  // set (e.g. the ticket was unlinked from the issue in Zendesk, and no
  // independent evidence source still proves the relationship — see the
  // unlink sweeps in @sla/ingestion): the row, its evidence, and every event
  // derived from it are kept for history, but this "active relationships" list
  // must not present it as current. That history stays reachable through the
  // timeline's own `issue_linked`/`issue_unlinked` events, not through this list.
  const links: CaseLinkDetail[] = caseRow.caseLinks
    .filter((link) => link.unlinkedAt === null && isIssueLinkSystem(link.system))
    .map((link) => ({
      system: link.system,
      externalId: link.externalId,
      method: link.method,
      confidence: link.confidence,
      url: externalUrlFor(link.system, {
        externalId: link.externalId,
        credentials: integrationOf(link.system)?.credentials,
        evidence: link.evidence,
      }),
      // A tracker's live status name (e.g. "In Progress") is stashed into the
      // link's evidence by its normalizer on every run — the timeline itself
      // only carries the coarse new/in_progress/resolved category.
      statusName:
        (link.evidence as { statusName?: string } | null)?.statusName ?? null,
    }));

  // 3.2/3.3: synthetic, display-only timeline rows with no NormalizedEvent of
  // their own — derived entirely from `commitments` (already computed above)
  // and the notifications already persisted for alerting. One "started"
  // marker per commitment always; the rest only when that lifecycle instant
  // actually happened.
  const syntheticTimelineEntries: TimelineEventDetail[] = commitments.flatMap(
    (c) => {
      const entries: TimelineEventDetail[] = [
        {
          id: `lifecycle:${c.id}:started`,
          occurredAt: c.startedAt,
          actor: "system",
          system: caseRow.system,
          type: "commitment_started",
          fromState: null,
          toState: null,
          commitmentKind: c.kind,
        },
      ];

      for (const change of c.targetChangeHistory) {
        entries.push({
          id: `policy_change:${c.id}:${change.changedAt}`,
          occurredAt: change.changedAt,
          actor: "system",
          system: caseRow.system,
          type: "policy_changed",
          fromState: null,
          toState: null,
          commitmentKind: c.kind,
          previousTargetMinutes: change.previousTargetMinutes,
          newTargetMinutes: change.newTargetMinutes,
          reason: change.reason,
        });
      }

      for (const notification of notificationsByCommitmentId.get(c.id) ?? []) {
        entries.push({
          id: `notification:${notification.id}`,
          occurredAt: notification.sentAt.toISOString(),
          actor: "system",
          system: caseRow.system,
          type: "commitment_at_risk",
          fromState: null,
          toState: null,
          commitmentKind: c.kind,
          thresholdPercent: notification.threshold,
        });
      }

      if (c.status === "breached" && c.effectiveDueAt) {
        entries.push({
          id: `lifecycle:${c.id}:breached`,
          occurredAt: c.effectiveDueAt,
          actor: "system",
          system: caseRow.system,
          type: "commitment_breached",
          fromState: null,
          toState: null,
          commitmentKind: c.kind,
        });
      }

      if (c.status === "met" && c.completionOccurredAt) {
        entries.push({
          id: `lifecycle:${c.id}:met`,
          occurredAt: c.completionOccurredAt,
          actor: "system",
          system: caseRow.system,
          type: "commitment_met",
          fromState: null,
          toState: null,
          commitmentKind: c.kind,
        });
      }

      if (c.status === "cancelled" && c.closedAt) {
        entries.push({
          id: `lifecycle:${c.id}:cancelled`,
          occurredAt: c.closedAt,
          actor: "system",
          system: caseRow.system,
          type: "commitment_cancelled",
          fromState: null,
          toState: null,
          commitmentKind: c.kind,
        });
      }

      return entries;
    },
  );

  const timeline: TimelineEventDetail[] = [
    ...domainEvents.map((e): TimelineEventDetail => ({
      id: e.id,
      occurredAt: e.occurredAt,
      actor: e.actor,
      system: e.system,
      type: e.type,
      fromState: e.fromState,
      toState: e.toState,
    })),
    ...syntheticTimelineEntries,
  ].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );

  // 3.5: the case's current ticket status, from the most recent state-bearing
  // event in the same stream the engine itself reads — nothing new stored.
  const latestStateEvent = [...domainEvents]
    .reverse()
    .find(
      (e) =>
        (e.type === "state_changed" ||
          e.type === "case_created" ||
          e.type === "case_closed") &&
        e.toState,
    );
  const status =
    (latestStateEvent?.toState as NormalizedState | undefined) ?? null;

  return {
    asOf,
    case: {
      id: caseRow.id,
      externalId: caseRow.externalId,
      subject: caseRow.subject,
      priority: caseRow.priority,
      tier: caseRow.tier,
      channel: caseRow.channel,
      openedAt: caseRow.openedAt.toISOString(),
      closedAt: caseRow.closedAt?.toISOString() ?? null,
      customerName: caseRow.customer?.name ?? null,
      requesterName: caseRow.requesterName ?? null,
      assigneeName: caseRow.assigneeName ?? null,
      status,
      system: caseRow.system,
      ticketUrl,
      sourceStaleSince,
      sourceNeverSynced,
    },
    currentLeg,
    commitments,
    legSpans,
    legTotals,
    engineeringLegTarget,
    runningIntervals,
    pausedIntervals,
    timeline,
    conversation,
    links,
  };
}

function isReplyEvent(
  event: NormalizedEvent,
): event is NormalizedEvent & {
  actor: "customer" | "agent";
  type: "agent_replied" | "customer_replied";
} {
  return event.type === "agent_replied" || event.type === "customer_replied";
}

/**
 * The case's public conversation, rendered by its source provider's adapter
 * from the raw events its reply events were derived from (and, for Zendesk,
 * the ticket snapshot that carries the opening message). Presentation-only:
 * never alters `domainEvents` or anything derived from it, and stays
 * message-only (the Activity Timeline is separate). Private notes are out of
 * scope: they're never derived into a NormalizedEvent to begin with (see
 * `isPublicCommentEvent` in @sla/zendesk, `isVisibleMessagePart` in
 * @sla/intercom), so there is no normalized record to read one from yet.
 */
async function buildConversationMessages(
  prisma: PrismaClient,
  caseRow: { externalId: string; system: IntegrationProvider; requesterName: string | null },
  domainEvents: NormalizedEvent[],
  sourceIntegrationId: string | null,
): Promise<ConversationMessageDetail[]> {
  // Only a ticket source renders a conversation; a tracker's or code host's
  // events on this case are never replies.
  const adapter = WEB_PROVIDERS[caseRow.system];
  if (!adapter?.renderConversation) return [];

  const replyEvents = domainEvents.filter(isReplyEvent);

  const context: unknown[] = [];
  if (sourceIntegrationId) {
    for (const prefix of adapter.conversationContext?.(caseRow.externalId) ?? []) {
      const row = await prisma.rawEvent.findFirst({
        where: { integrationId: sourceIntegrationId, providerEventId: { startsWith: prefix } },
        orderBy: { fetchedAt: "desc" },
        select: { payload: true },
      });
      context.push(row?.payload);
    }
  }

  const payloads = new Map<string, unknown>();
  if (replyEvents.length > 0) {
    const rawEventRows = await prisma.rawEvent.findMany({
      where: {
        id: { in: [...new Set(replyEvents.map((e) => e.sourceRawEventId))] },
      },
      select: { id: true, payload: true },
    });
    for (const row of rawEventRows) payloads.set(row.id, row.payload);
  }

  return adapter.renderConversation({
    case: { externalId: caseRow.externalId, requesterName: caseRow.requesterName },
    events: domainEvents.map(
      (event): ConversationEventRef => ({
        id: event.id,
        type: event.type,
        actor: event.actor,
        occurredAt: event.occurredAt,
        sourceRawEventId: event.sourceRawEventId,
        sourceSequence: event.sourceSequence,
      }),
    ),
    payloads,
    context,
  });
}
