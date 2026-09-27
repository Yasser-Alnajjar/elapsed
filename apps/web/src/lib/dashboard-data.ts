import type { PrismaClient } from "@sla/db";
import {
  deriveLegSpans,
  evaluateCommitment,
  evaluateEngineeringLegTarget,
  sumLegMinutes,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type CommitmentStatus,
  type EngineeringLegEvaluation,
  type Leg,
  type LegSpan,
  type NormalizedEvent,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { toCommitmentDomain, toNormalizedEventDomain } from "@sla/commitments";
import { getCycleTimeAnomalies } from "./anomaly-data";
import { getProjectAnalytics } from "./analytics-data";
import type {
  AgingEscalationRow,
  AtRiskRow,
  AttributionLedger,
  CommitmentKindHealth,
  DashboardData,
  FailedAlertRow,
  IntegrationHealthRow,
  LinkedIssueRef,
  TotalEscalatedSummary,
  UnmatchedCaseRow,
} from "./types/dashboard";
import type { IntegrationProvider } from "./types/integrations";

const COMMITMENT_KINDS: CommitmentKind[] = ["first_response", "next_reply", "resolution"];
// Everything shown on the "silently not being monitored" panels needs to
// stay readable without scrolling, same rationale as AT_RISK_LIMIT/AGING_LIMIT.
const UNMATCHED_CASES_LIMIT = 10;
const FAILED_ALERTS_LIMIT = 10;

const ISSUE_TRACKER_SYSTEMS = new Set(["jira", "linear", "github"]);

/** Picks one active link to show per case — `certain` over `probable` when a case somehow carries both. */
function preferredLink(
  links: { system: string; externalId: string; confidence: string; method: string }[],
): LinkedIssueRef | null {
  const trackerLinks = links.filter((l) => ISSUE_TRACKER_SYSTEMS.has(l.system));
  if (trackerLinks.length === 0) return null;
  const best =
    trackerLinks.find((l) => l.confidence === "certain") ?? trackerLinks[0]!;
  return {
    system: best.system as LinkedIssueRef["system"],
    externalId: best.externalId,
    confidence: best.confidence as LinkedIssueRef["confidence"],
    method: best.method as LinkedIssueRef["method"],
  };
}

// "Period" for the two reporting metrics (breach count, compliance %) is a
// trailing 30-day window rather than a calendar month — it needs no
// timezone decision per organization and never shows a partial period.
const PERIOD_DAYS = 30;
// The wall-monitor screen this feeds must be readable without scrolling
// (Phase 17), so each list is capped and reports how much it left out.
const AT_RISK_LIMIT = 12;
const AGING_LIMIT = 8;

function minutesBetween(from: string, to: Date): number {
  return Math.round((to.getTime() - new Date(from).getTime()) / 60000);
}

function complianceOf(rows: { status: CommitmentStatus }[]): number | null {
  if (rows.length === 0) return null;
  const met = rows.filter((r) => r.status === "met").length;
  return Math.round((met / rows.length) * 1000) / 10;
}

/**
 * Assembles the one-screen dashboard (Phase 17). The at-risk list and the
 * engineering-aging list are computed live with `evaluateCommitment` /
 * `deriveLegSpans` — the same pure functions the worker uses — because
 * `remainingMinutes` is derived, never stored (schema.prisma's rule), and an
 * `Evaluation` row is only a transition snapshot, not a per-minute reading.
 * Compliance % reads persisted, worker-maintained state instead: it's scoped
 * to a trailing period of things that already happened, not "right now".
 * The breach count and "breached this period" list come from
 * `getProjectAnalytics`'s breaches, placed by when the SLA clock actually
 * crossed the target (`computeBreachedAt`), not when the worker evaluated
 * it — the same set the Breaches Over Time chart plots.
 */
export async function getDashboardData(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date = new Date(),
): Promise<DashboardData> {
  const asOf = asOfDate.toISOString();
  const periodStart = new Date(asOfDate.getTime() - PERIOD_DAYS * 86_400_000);
  const previousPeriodStart = new Date(
    periodStart.getTime() - PERIOD_DAYS * 86_400_000,
  );

  const [
    openCommitmentRows,
    currentPeriodClosedRows,
    previousPeriodClosedRows,
    organization,
    cycleTimeAnomalies,
    unmatchedCaseRows,
    integrationRows,
    failedNotificationRows,
  ] = await Promise.all([
    prisma.commitment.findMany({
      where: { case: { organizationId, deletedAt: null }, closedAt: null },
      include: { case: { include: { customer: true } } },
    }),
    prisma.commitment.findMany({
      where: {
        case: { organizationId, deletedAt: null },
        closedAt: { gte: periodStart, lte: asOfDate },
        status: { in: ["met", "breached"] },
      },
      select: {
        caseId: true,
        status: true,
        closedAt: true,
        case: { select: { openedAt: true } },
      },
    }),
    prisma.commitment.findMany({
      where: {
        case: { organizationId, deletedAt: null },
        closedAt: { gte: previousPeriodStart, lt: periodStart },
        status: { in: ["met", "breached"] },
      },
      select: { status: true },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, engineeringLegTargetMinutes: true, timezone: true },
    }),
    getCycleTimeAnomalies(prisma, organizationId),
    // Phase 6.2: open cases the commitment pipeline never matched to any
    // policy — `commitments: { none: {} }` is the direct read of "the
    // pipeline's `continue` on no match left this case with zero rows".
    prisma.case.findMany({
      where: { organizationId, deletedAt: null, closedAt: null, commitments: { none: {} } },
      select: { id: true, externalId: true, subject: true, openedAt: true, customer: { select: { name: true } } },
      orderBy: { openedAt: "asc" },
    }),
    // Phase 6.3: every integration this organization has ever connected —
    // a provider with no row at all is onboarding's concern, not this panel's.
    prisma.integration.findMany({
      where: { organizationId },
      select: { provider: true, status: true, lastSyncAt: true, lastSyncError: true },
    }),
    // Phase 6.4.
    prisma.notificationFailure.findMany({
      where: { commitment: { case: { organizationId, deletedAt: null } } },
      include: { commitment: { include: { case: { select: { id: true, externalId: true, subject: true } } } } },
      orderBy: { lastFailedAt: "desc" },
    }),
  ]);

  const engineeringLegTargetMinutes =
    organization?.engineeringLegTargetMinutes ?? null;
  const timezone = organization?.timezone ?? "UTC";

  const policyVersionIds = [
    ...new Set(openCommitmentRows.map((c) => c.policyVersionId)),
  ];
  const calendarVersionIds = [
    ...new Set(openCommitmentRows.map((c) => c.calendarVersionId)),
  ];
  const caseIds = [...new Set(openCommitmentRows.map((c) => c.caseId))];
  // Closed-in-period cases, for the "Total Escalated" cross-team aggregate
  // and the Attribution Ledger's period-scoped leg-hour totals — both need
  // this period's closed cases' leg history too, not just what's open now.
  const closedInPeriodCaseIds = [
    ...new Set(currentPeriodClosedRows.map((c) => c.caseId)),
  ];
  const periodCaseIds = [...new Set([...caseIds, ...closedInPeriodCaseIds])];

  const [policyVersionRows, calendarVersionRows, eventRows, caseLinkRows] =
    await Promise.all([
      policyVersionIds.length > 0
        ? prisma.sLAPolicyVersion.findMany({
            where: { id: { in: policyVersionIds } },
          })
        : Promise.resolve([]),
      calendarVersionIds.length > 0
        ? prisma.businessCalendarVersion.findMany({
            where: { id: { in: calendarVersionIds } },
          })
        : Promise.resolve([]),
      periodCaseIds.length > 0
        ? prisma.normalizedEvent.findMany({ where: { caseId: { in: periodCaseIds } } })
        : Promise.resolve([]),
      periodCaseIds.length > 0
        ? prisma.caseLink.findMany({
            where: { caseId: { in: periodCaseIds }, unlinkedAt: null },
          })
        : Promise.resolve([]),
    ]);

  const linksByCaseId = new Map<
    string,
    { system: string; externalId: string; confidence: string; method: string }[]
  >();
  for (const link of caseLinkRows) {
    const existing = linksByCaseId.get(link.caseId);
    if (existing) existing.push(link);
    else linksByCaseId.set(link.caseId, [link]);
  }
  const linkedIssueFor = (caseId: string): LinkedIssueRef | null =>
    preferredLink(linksByCaseId.get(caseId) ?? []);

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

  const legSpansByCaseId = new Map<string, LegSpan[]>();
  const legSpansFor = (caseId: string, caseOpenedAt: Date): LegSpan[] => {
    const cached = legSpansByCaseId.get(caseId);
    if (cached) return cached;
    const { spans } = deriveLegSpans(eventsByCaseId.get(caseId) ?? [], {
      caseOpenedAt: caseOpenedAt.toISOString(),
    });
    legSpansByCaseId.set(caseId, spans);
    return spans;
  };

  const openCaseOpenedAtById = new Map<string, Date>(
    openCommitmentRows.map((c) => [c.caseId, c.case.openedAt]),
  );
  const closedCaseOpenedAtById = new Map<string, Date>(
    currentPeriodClosedRows
      .filter((c): c is typeof c & { case: { openedAt: Date } } => c.case?.openedAt != null)
      .map((c) => [c.caseId, c.case.openedAt]),
  );

  const atRisk: AtRiskRow[] = [];
  const otherOpenCommitments: AtRiskRow[] = [];
  const casesSeenForAging = new Set<string>();
  const agingInEngineering: AgingEscalationRow[] = [];
  // Phase 6.1: on-track/at-risk/breached per kind, among open commitments —
  // every kind starts at zero so a kind with nothing open still renders.
  const healthByKindMap = new Map<CommitmentKind, { onTrack: number; atRisk: number; breached: number }>(
    COMMITMENT_KINDS.map((kind) => [kind, { onTrack: 0, atRisk: 0, breached: 0 }]),
  );

  for (const row of openCommitmentRows) {
    const policyVersion = policyVersionsById.get(row.policyVersionId);
    const calendar = calendarsById.get(row.calendarVersionId);
    if (!policyVersion || !calendar) continue;

    const events = eventsByCaseId.get(row.caseId) ?? [];
    const evaluation = evaluateCommitment(
      toCommitmentDomain(row),
      events,
      policyVersion,
      calendar,
      asOf,
    );
    const spans = legSpansFor(row.caseId, row.case.openedAt);
    const currentSpan = spans[spans.length - 1];
    const currentLeg: Leg = currentSpan?.leg ?? "unknown";
    const minutesInCurrentLeg = currentSpan
      ? minutesBetween(currentSpan.startedAt, asOfDate)
      : 0;
    const targetMinutes =
      policyVersion.targets.find((t) => t.kind === row.kind)?.minutes ?? 0;
    const supportLegMinutes = sumLegMinutes(spans, "support", asOf);
    const engineeringLegMinutes = sumLegMinutes(spans, "engineering", asOf);
    const linkedIssue = linkedIssueFor(row.caseId);

    const sharedRow = {
      commitmentId: row.id,
      caseId: row.caseId,
      externalId: row.case.externalId,
      subject: row.case.subject,
      customerName: row.case.customer?.name ?? null,
      requesterName: row.case.requesterName ?? null,
      kind: row.kind,
      remainingMinutes: evaluation.remainingMinutes,
      status: evaluation.status,
      currentLeg,
      minutesInCurrentLeg,
      priority: row.case.priority ?? null,
      tier: row.case.customer?.tier ?? row.case.tier ?? null,
      targetMinutes,
      supportLegMinutes,
      engineeringLegMinutes,
      linkedIssue,
    };

    if (
      evaluation.status === "on_track" ||
      evaluation.status === "at_risk" ||
      evaluation.status === "breached"
    ) {
      atRisk.push(sharedRow);
      const tally = healthByKindMap.get(row.kind);
      if (tally) {
        if (evaluation.status === "on_track") tally.onTrack += 1;
        else if (evaluation.status === "at_risk") tally.atRisk += 1;
        else tally.breached += 1;
      }
    } else {
      otherOpenCommitments.push(sharedRow);
    }

    if (!casesSeenForAging.has(row.caseId)) {
      casesSeenForAging.add(row.caseId);
      if (currentLeg === "engineering" && currentSpan) {
        const legTarget: EngineeringLegEvaluation | null =
          engineeringLegTargetMinutes !== null
            ? evaluateEngineeringLegTarget(
                engineeringLegMinutes,
                engineeringLegTargetMinutes,
                true,
              )
            : null;
        agingInEngineering.push({
          caseId: row.caseId,
          externalId: row.case.externalId,
          customerName: row.case.customer?.name ?? null,
          minutesInCurrentLeg,
          legTarget,
          linkedIssue,
          queueWaitMinutes: minutesBetween(
            row.case.openedAt.toISOString(),
            new Date(currentSpan.startedAt),
          ),
        });
      }
    }
  }

  atRisk.sort((a, b) => a.remainingMinutes - b.remainingMinutes);
  agingInEngineering.sort(
    (a, b) => b.minutesInCurrentLeg - a.minutesInCurrentLeg,
  );

  // Operational anomaly banner: how many of the full (pre-slice) aging list
  // have actually exceeded the configured engineering-leg target. Null
  // (rather than 0) when no target is configured — "exceeded" has no
  // meaning without one, so the banner must say "not configured", not "0".
  const engineeringOverTargetCount =
    engineeringLegTargetMinutes !== null
      ? agingInEngineering.filter((r) => r.legTarget?.status === "breached").length
      : null;
  const avgQueueWaitMinutes =
    agingInEngineering.length > 0
      ? agingInEngineering.reduce((sum, r) => sum + (r.queueWaitMinutes ?? 0), 0) /
        agingInEngineering.length
      : null;

  // "Breached (closed) in the prior 30-day period" — the same closed+status
  // rows already fetched for the previous-period compliance figure, read a
  // second way for the KPI tile's trend arrow. Not a re-derivation of
  // `findBreachesInPeriod` for the prior window: that would need its own
  // event/policy queries for a number that's only ever shown as a delta.
  const breachedPreviousPeriodCount = previousPeriodClosedRows.filter(
    (r) => r.status === "breached",
  ).length;

  // "Total Escalated" + the Attribution Ledger: derived over every case
  // tracked this period — open now, or closed within it — using the same
  // `deriveLegSpans`/`sumLegMinutes` primitives as the rest of the page.
  // Cases whose `case.openedAt` isn't loaded (never true against the real
  // database; only possible against a narrower test double) are excluded
  // from these two aggregates rather than crashing on a missing field.
  let totalEscalatedCount = 0;
  let totalEscalatedLinkedCertain = 0;
  let supportLegMinutesTotal = 0;
  let engineeringLegMinutesTotal = 0;
  let waitingCustomerLegMinutesTotal = 0;
  for (const caseId of periodCaseIds) {
    const caseOpenedAt = openCaseOpenedAtById.get(caseId) ?? closedCaseOpenedAtById.get(caseId);
    if (!caseOpenedAt) continue;
    const spans = legSpansFor(caseId, caseOpenedAt);
    supportLegMinutesTotal += sumLegMinutes(spans, "support", asOf);
    engineeringLegMinutesTotal += sumLegMinutes(spans, "engineering", asOf);
    waitingCustomerLegMinutesTotal += sumLegMinutes(spans, "waiting_customer", asOf);
    if (spans.some((s) => s.leg === "engineering")) {
      totalEscalatedCount += 1;
      if (linkedIssueFor(caseId)?.confidence === "certain") {
        totalEscalatedLinkedCertain += 1;
      }
    }
  }
  const totalEscalated: TotalEscalatedSummary = {
    count: totalEscalatedCount,
    linkedCertain: totalEscalatedLinkedCertain,
    unlinkedOrOther: totalEscalatedCount - totalEscalatedLinkedCertain,
  };
  const attributionLedger: AttributionLedger = {
    supportLegHours: Math.round((supportLegMinutesTotal / 60) * 10) / 10,
    engineeringLegHours: Math.round((engineeringLegMinutesTotal / 60) * 10) / 10,
    waitingCustomerLegHours: Math.round((waitingCustomerLegMinutesTotal / 60) * 10) / 10,
    linkingPrecisionPercent:
      totalEscalatedCount > 0
        ? Math.round((totalEscalatedLinkedCertain / totalEscalatedCount) * 1000) / 10
        : null,
    directMatches: totalEscalatedLinkedCertain,
    unlinkedOrStandalone: totalEscalatedCount - totalEscalatedLinkedCertain,
    auditTimestamp: asOf,
  };

  const { analytics, breachedThisPeriod } = await getProjectAnalytics(
    prisma,
    organizationId,
    periodStart,
    asOfDate,
    [...atRisk, ...otherOpenCommitments].map((row) => ({
      caseId: row.caseId,
      status: row.status,
    })),
    currentPeriodClosedRows,
    timezone,
  );

  const healthByKind: CommitmentKindHealth[] = COMMITMENT_KINDS.map((kind) => ({
    kind,
    ...(healthByKindMap.get(kind) ?? { onTrack: 0, atRisk: 0, breached: 0 }),
  }));

  const unmatchedCases: UnmatchedCaseRow[] = unmatchedCaseRows.slice(0, UNMATCHED_CASES_LIMIT).map((row) => ({
    caseId: row.id,
    externalId: row.externalId,
    subject: row.subject,
    customerName: row.customer?.name ?? null,
    openedAt: row.openedAt.toISOString(),
  }));

  const integrationHealth: IntegrationHealthRow[] = integrationRows.map((row) => ({
    provider: row.provider as IntegrationProvider,
    reauthRequired: row.status === "reauth_required",
    permissionDenied: row.status === "permission_denied",
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastSyncError: row.lastSyncError,
  }));

  const failedAlerts: FailedAlertRow[] = failedNotificationRows
    .filter(
      (row): row is typeof row & { commitment: NonNullable<(typeof row)["commitment"]> & { case: NonNullable<(typeof row)["commitment"]["case"]> } } =>
        row.commitment?.case != null,
    )
    .slice(0, FAILED_ALERTS_LIMIT)
    .map((row) => ({
      commitmentId: row.commitmentId,
      caseId: row.commitment.case.id,
      externalId: row.commitment.case.externalId,
      subject: row.commitment.case.subject,
      kind: row.commitment.kind,
      threshold: row.threshold,
      error: row.error,
      attempts: row.attempts,
      firstFailedAt: row.firstFailedAt.toISOString(),
      lastFailedAt: row.lastFailedAt.toISOString(),
    }));

  return {
    asOf,
    organizationName: organization?.name ?? null,
    periodDays: PERIOD_DAYS,
    atRisk: atRisk.slice(0, AT_RISK_LIMIT),
    atRiskOverflowCount: Math.max(0, atRisk.length - AT_RISK_LIMIT),
    otherOpenCommitments,
    breachedThisPeriod,
    breachedPreviousPeriodCount,
    agingInEngineering: agingInEngineering.slice(0, AGING_LIMIT),
    agingOverflowCount: Math.max(0, agingInEngineering.length - AGING_LIMIT),
    engineeringOverTargetCount,
    avgQueueWaitMinutes,
    totalEscalated,
    attributionLedger,
    compliance: {
      current: complianceOf(currentPeriodClosedRows),
      previous: complianceOf(previousPeriodClosedRows),
    },
    cycleTimeAnomalies,
    analytics,
    healthByKind,
    unmatchedCases,
    unmatchedOverflowCount: Math.max(0, unmatchedCaseRows.length - UNMATCHED_CASES_LIMIT),
    integrationHealth,
    failedAlerts,
    failedAlertsOverflowCount: Math.max(0, failedNotificationRows.length - FAILED_ALERTS_LIMIT),
  };
}
