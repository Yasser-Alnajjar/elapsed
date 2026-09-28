import { perfCount, withPerfScope, type PrismaClient } from "@sla/db";
import {
  BREACH_NOTIFICATION_THRESHOLD,
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
import {
  publicCommentBodiesInAudit,
  type ZendeskAudit,
  type ZendeskCommentBody,
  type ZendeskCredentials,
} from "@sla/zendesk";
import {
  buildIntercomConversationUrl,
  extractIntercomMessageBody,
  type IntercomConversationPart,
  type IntercomCredentials,
} from "@sla/intercom";
import type { JiraCredentials } from "@sla/jira";
import type {
  CaseDetailData,
  CaseLinkDetail,
  CommitmentDetail,
  ConversationMessageDetail,
  LegTotal,
  TimelineEventDetail,
} from "./types/cases";

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

  const caseRow = await prisma.case.findFirst({
    where: { id: caseId, organizationId, deletedAt: null },
    include: { customer: true, caseLinks: true, commitments: true },
  });
  if (!caseRow) return null;

  const [
    eventRows,
    zendeskIntegration,
    jiraIntegration,
    intercomIntegration,
    organization,
  ] = await Promise.all([
    prisma.normalizedEvent.findMany({
      where: { caseId },
      orderBy: [{ occurredAt: "asc" }, { sourceSequence: "asc" }],
    }),
    prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "zendesk" },
      },
    }),
    prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "jira" },
      },
    }),
    prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "intercom" },
      },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { engineeringLegTargetMinutes: true },
    }),
  ]);

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

  const [
    policyVersionRows,
    calendarVersionRows,
    policyChangeRows,
    notificationRows,
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

  // The engine's own total order, so the timeline lists same-instant events
  // exactly as the evaluations below consumed them.
  const domainEvents: NormalizedEvent[] = sortNormalizedEvents(
    eventRows.map(toNormalizedEventDomain),
  );

  // Presentation-only: reads each reply's source text out of RawEvent, never
  // altering domainEvents or anything derived from it below.
  const conversation = await buildConversationMessages(
    prisma,
    caseRow,
    domainEvents,
    zendeskIntegration?.id ?? null,
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

  const zendeskCredentials =
    (zendeskIntegration?.credentials as ZendeskCredentials | null) ?? null;
  const jiraCredentials =
    (jiraIntegration?.credentials as JiraCredentials | null) ?? null;

  const intercomWorkspaceId =
    (intercomIntegration?.credentials as IntercomCredentials | null)
      ?.workspaceId ?? null;

  // Gated on caseRow.system (roadmap step 22), not just "is Zendesk
  // connected": an org with both ticket sources connected would otherwise
  // build a Zendesk ticket link for an Intercom-sourced case whose externalId
  // was never a Zendesk ticket id, or vice versa. Intercom's link needs the
  // workspace id the backfill records from `GET /me` — null until the first
  // sync after connecting.
  const ticketUrl =
    caseRow.system === "zendesk" && zendeskCredentials
      ? `https://${zendeskCredentials.subdomain}.zendesk.com/agent/tickets/${caseRow.externalId}`
      : caseRow.system === "intercom" && intercomWorkspaceId
        ? buildIntercomConversationUrl(intercomWorkspaceId, caseRow.externalId)
        : null;

  // Every CaseLink system this page knows how to render — a Zendesk CaseLink
  // never actually occurs (Case itself *is* the Zendesk side), but the type
  // guard stays honest about the full IntegrationProvider union. Excludes a
  // link whose `unlinkedAt` is set (e.g. the ticket was unlinked from the
  // issue in Zendesk, and no independent evidence source still proves the
  // relationship — see `runZendeskJiraLinkCorrelation`'s unlink sweep): the
  // row, its evidence, and every event derived from it are kept for history,
  // but this "active relationships" list must not present it as current.
  // That history stays reachable through the timeline's own
  // `issue_linked`/`issue_unlinked` events, not through this list.
  const links: CaseLinkDetail[] = caseRow.caseLinks
    .filter(
      (
        link,
      ): link is typeof link & {
        system: "jira" | "zendesk" | "linear" | "github";
      } =>
        link.unlinkedAt === null &&
        (link.system === "jira" ||
          link.system === "zendesk" ||
          link.system === "linear" ||
          link.system === "github"),
    )
    .map((link) => ({
      system: link.system,
      externalId: link.externalId,
      method: link.method,
      confidence: link.confidence,
      url:
        link.system === "jira" && jiraCredentials
          ? `${jiraCredentials.siteUrl.replace(/\/$/, "")}/browse/${link.externalId}`
          : link.system === "zendesk" && zendeskCredentials
            ? `https://${zendeskCredentials.subdomain}.zendesk.com/agent/tickets/${link.externalId}`
            : link.system === "linear"
              ? // Linear's stored OAuth credentials carry no workspace URL to
                // reconstruct a browse link from (unlike Jira's `siteUrl` or
                // Zendesk's `subdomain`), so the correlator (roadmap step 15)
                // captures the issue's own `url` into evidence at link time.
                ((link.evidence as { issueUrl?: string } | null)?.issueUrl ??
                null)
              : link.system === "github"
                ? // Unlike Linear, a GitHub CaseLink's externalId itself
                  // (`owner/repo#number`) is enough to build the PR URL —
                  // no credential lookup or evidence capture needed.
                  `https://github.com/${link.externalId.replace("#", "/pull/")}`
                : null,
      // Jira's live status name (e.g. "In Progress") is stashed into
      // evidence by runJiraNormalization on every run — the timeline itself
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
 * The case's full public conversation: every `agent_replied`/
 * `customer_replied` event (already in `domainEvents`' deterministic order,
 * with SLA relevance irrelevant to inclusion — an event that fed no
 * commitment still appears here) paired with the message text its source
 * RawEvent carries. Private/internal notes are out of scope: they're never
 * derived into a NormalizedEvent to begin with (see `isPublicCommentEvent`
 * in @sla/zendesk, `isVisibleMessagePart` in @sla/intercom), so there is no
 * normalized record to read one from yet.
 *
 * For Zendesk, this is prepended with the ticket's own opening
 * message (see `buildZendeskConversationMessages`) — the description an
 * email-created ticket carries, which `deriveNormalizedEventsForTicket`
 * deliberately never turns into an `agent_replied`/`customer_replied` event
 * (comments on the creation audit never count, so first-response/next-reply
 * SLA math can't see it either — this stays purely a display concern).
 */
async function buildConversationMessages(
  prisma: PrismaClient,
  caseRow: { externalId: string; system: string; requesterName: string | null },
  domainEvents: NormalizedEvent[],
  zendeskIntegrationId: string | null,
): Promise<ConversationMessageDetail[]> {
  const replyEvents = domainEvents.filter(isReplyEvent);

  if (caseRow.system === "zendesk") {
    return buildZendeskConversationMessages(
      prisma,
      caseRow,
      domainEvents,
      replyEvents,
      zendeskIntegrationId,
    );
  }

  if (replyEvents.length === 0) return [];

  const rawEventRows = await prisma.rawEvent.findMany({
    where: {
      id: { in: [...new Set(replyEvents.map((e) => e.sourceRawEventId))] },
    },
    select: { id: true, payload: true },
  });
  const payloadById = new Map(rawEventRows.map((row) => [row.id, row.payload]));

  if (caseRow.system === "intercom") {
    return buildIntercomConversationMessages(replyEvents, payloadById);
  }
  // Jira/Linear/GitHub cases never carry agent_replied/customer_replied
  // events (only zendesk.ts/intercom.ts's normalizers ever derive them), so
  // replyEvents would already be empty here — this branch is unreachable in
  // practice, kept only so a case with a mixed-provider event stream (a
  // linked issue's events on a Zendesk/Intercom case) can't fall through
  // silently if that ever changes.
  return [];
}

async function buildZendeskConversationMessages(
  prisma: PrismaClient,
  caseRow: { externalId: string; requesterName: string | null },
  domainEvents: NormalizedEvent[],
  replyEvents: (NormalizedEvent & {
    actor: "customer" | "agent";
    type: "agent_replied" | "customer_replied";
  })[],
  zendeskIntegrationId: string | null,
): Promise<ConversationMessageDetail[]> {
  // The ticket's own requester id, so a customer message can be attributed
  // to the case's already-known `requesterName` — never guessed for anyone
  // else. Zendesk's audit sideload only ever stores a comment author's role
  // (see `mapUserToRawEvent`'s privacy-minimization comment in
  // @sla/zendesk), never their name, so any other author stays unnamed.
  let requesterId: number | null = null;
  // The ticket's own opening message (its `description`), derived from the
  // ticket snapshot rather than a comment — see the module doc comment on
  // `buildConversationMessages`. Never sourced from a synthesized comment or
  // written back to RawEvent/NormalizedEvent; this is purely a display-time
  // read of data `mapTicketToRawEvent` already persisted.
  let initialMessage: ConversationMessageDetail | null = null;
  const caseCreatedEvent = domainEvents.find(
    (event) => event.type === "case_created",
  );

  if (zendeskIntegrationId) {
    const ticketRow = await prisma.rawEvent.findFirst({
      where: {
        integrationId: zendeskIntegrationId,
        providerEventId: { startsWith: `ticket:${caseRow.externalId}:` },
      },
      orderBy: { fetchedAt: "desc" },
      select: { payload: true },
    });
    const ticketPayload = ticketRow?.payload as
      { requester_id?: number | null; description?: string | null } | undefined;
    requesterId = ticketPayload?.requester_id ?? null;

    const description = ticketPayload?.description?.trim();
    // 3.7: shown for every actor, including "system" (a trigger/automation/
    // rule created the ticket) — a neutral, centered bubble rather than a
    // Customer/Agent one (see ConversationMessageBubble).
    if (description && caseCreatedEvent) {
      const actor = caseCreatedEvent.actor;
      initialMessage = {
        // Namespaced off the case_created event's own id (a cuid, unique per
        // case) — never a raw Zendesk comment/audit event id, so this can
        // never collide with a real agent_replied/customer_replied message.
        id: `${caseCreatedEvent.id}:description`,
        occurredAt: caseCreatedEvent.occurredAt,
        actor,
        type:
          actor === "agent"
            ? "agent_replied"
            : actor === "customer"
              ? "customer_replied"
              : "case_created",
        authorName: actor === "customer" ? caseRow.requesterName : null,
        isRequester: actor === "customer" ? true : undefined,
        body: description,
      };
    }
  }

  if (replyEvents.length === 0) {
    return initialMessage ? [initialMessage] : [];
  }

  const rawEventRows = await prisma.rawEvent.findMany({
    where: {
      id: { in: [...new Set(replyEvents.map((e) => e.sourceRawEventId))] },
    },
    select: { id: true, payload: true },
  });
  const payloadById = new Map(rawEventRows.map((row) => [row.id, row.payload]));

  // Group replies by the audit they came from, in each audit's own
  // sourceSequence order — the order `deriveNormalizedEventsForTicket`
  // walked that audit's events in.
  const groups = new Map<string, typeof replyEvents>();
  for (const event of replyEvents) {
    const group = groups.get(event.sourceRawEventId);
    if (group) group.push(event);
    else groups.set(event.sourceRawEventId, [event]);
  }

  const bodyByEventId = new Map<string, ZendeskCommentBody>();
  // Explicit dedupe by the audit's own id + the comment's own id within it
  // (3.7/C-5) — a globally stable key (unlike `sourceRawEventId`, which
  // names a RawEvent snapshot, not the underlying Zendesk audit) — on top
  // of, not instead of, normalization's own uniqueness: guards display
  // against ever double-rendering the same underlying comment even if two
  // NormalizedEvent rows, or two RawEvent snapshots, somehow both point at it.
  const seenComments = new Set<string>();
  for (const [rawEventId, group] of groups) {
    const audit = payloadById.get(rawEventId) as ZendeskAudit | undefined;
    if (!audit) continue;
    const comments = publicCommentBodiesInAudit(audit);
    const ordered = [...group].sort(
      (a, b) => (a.sourceSequence ?? 0) - (b.sourceSequence ?? 0),
    );
    // An audit almost always carries exactly one public comment; when it
    // carries more, both lists were built by walking that audit's events in
    // the same order, so pairing them index-wise recovers the right text
    // for each. A length mismatch (e.g. a comment on the ticket's own
    // creation audit, excluded from `agent_replied`/`customer_replied` but
    // not from this raw scan) pairs as far as the shorter list goes, rather
    // than guessing or throwing.
    ordered.forEach((event, index) => {
      const comment = comments[index];
      if (!comment) return;
      const dedupeKey = `${audit.id}:${comment.id}`;
      if (seenComments.has(dedupeKey)) return;
      seenComments.add(dedupeKey);
      bodyByEventId.set(event.id, comment);
    });
  }

  const messages: ConversationMessageDetail[] = [];
  for (const event of replyEvents) {
    const comment = bodyByEventId.get(event.id);
    if (!comment) continue;
    const isRequester =
      event.actor === "customer" &&
      comment.authorId != null &&
      comment.authorId === requesterId;
    messages.push({
      id: event.id,
      occurredAt: event.occurredAt,
      actor: event.actor,
      type: event.type,
      authorName: isRequester ? caseRow.requesterName : null,
      isRequester: isRequester ? true : undefined,
      body: comment.body,
    });
  }

  return initialMessage ? [initialMessage, ...messages] : messages;
}

function buildIntercomConversationMessages(
  replyEvents: (NormalizedEvent & {
    actor: "customer" | "agent";
    type: "agent_replied" | "customer_replied";
  })[],
  payloadById: Map<string, unknown>,
): ConversationMessageDetail[] {
  // Explicit dedupe by source part id (3.7/C-5), on top of — not instead of —
  // normalization's own uniqueness (each RawEvent is one Intercom part).
  const seenParts = new Set<string>();
  return replyEvents.flatMap((event) => {
    if (seenParts.has(event.sourceRawEventId)) return [];
    const part = payloadById.get(event.sourceRawEventId) as
      IntercomConversationPart | undefined;
    if (!part) return [];
    const message = extractIntercomMessageBody(part);
    if (!message) return [];
    seenParts.add(event.sourceRawEventId);
    return [
      {
        id: event.id,
        occurredAt: event.occurredAt,
        actor: event.actor,
        type: event.type,
        authorName: message.authorName,
        body: htmlToPlainText(message.bodyHtml),
      },
    ];
  });
}

/**
 * Intercom message bodies are HTML. This strips markup down to plain text
 * for display — the conversation view never uses `dangerouslySetInnerHTML`,
 * so third-party HTML is never interpreted as markup.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
