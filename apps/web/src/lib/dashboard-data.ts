import { getWorkerSettingsForRead, perfCount, withPerfScope, Prisma, type PrismaClient } from "@sla/db";
import {
  COMMITMENT_KINDS,
  deriveLegSpans,
  evaluateCommitment,
  sumLegMinutes,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type CommitmentStatus,
  type Leg,
  type LegSpan,
  type NormalizedEvent,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { toCommitmentDomain, toNormalizedEventDomain } from "@sla/commitments";
import { staleFields } from "./freshness-data";
import { getLinkCoveragePanel } from "./link-coverage-data";
import { getCycleTimeAnomalies } from "./anomaly-data";
import { getProjectAnalytics, type BreachCandidateRow } from "./analytics-data";
import type {
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
import { ISSUE_LINK_PROVIDERS, isIssueLinkSystem, preferredIssueLink } from "./providers";

// Everything shown on the "silently not being monitored" panels needs to
// stay readable without scrolling, same rationale as AT_RISK_LIMIT.
const UNMATCHED_CASES_LIMIT = 10;
const FAILED_ALERTS_LIMIT = 10;

/** Picks one active link to show per case — `certain` over `probable` when a case somehow carries both. */
function preferredLink(
  links: {
    system: string;
    externalId: string;
    confidence: string;
    method: string;
  }[],
): LinkedIssueRef | null {
  const best = preferredIssueLink(links);
  if (!best) return null;
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
// (Phase 17), so the list is capped and reports how much it left out.
const AT_RISK_LIMIT = 12;
// A generous buffer over AT_RISK_LIMIT: candidates are ordered by `dueAt`
// (a close proxy for live `remainingMinutes`), live-evaluated, then re-sorted
// and sliced to AT_RISK_LIMIT — see the "Snapshot vs live" ground rule in
// performance-plan.md and `getAlertSummary` (alert-summary-data.ts) for the
// same pattern.
const AT_RISK_CANDIDATE_TAKE = 60;

function complianceOf(rows: { status: CommitmentStatus }[]): number | null {
  if (rows.length === 0) return null;
  const met = rows.filter((r) => r.status === "met").length;
  return Math.round((met / rows.length) * 1000) / 10;
}

/** Whether the dashboard shows anything real yet: a case opened in the window, an open commitment, or a breach. */
export function dashboardHasData(data: DashboardData): boolean {
  return (
    data.linkCoverage.cases > 0 ||
    data.breachedThisPeriod.total > 0 ||
    data.healthByKind.some((kind) => kind.onTrack + kind.atRisk + kind.breached > 0)
  );
}

/**
 * Assembles the one-screen dashboard (Phase 17). Only the At-Risk list is
 * computed live with `evaluateCommitment`/`deriveLegSpans` — the same pure
 * functions the worker uses — and only over a bounded, `dueAt`-ordered
 * candidate page (performance-plan.md Phase 2 item 2), not every open
 * commitment in the org. Everything else (health by kind, compliance, the
 * breach KPI/charts, Total Escalated, the Attribution Ledger) reads
 * persisted `Commitment.status`/`dueAt` and closed-period rows instead.
 * The breach count and "breached this period" list come from
 * `getProjectAnalytics`'s breaches, placed by when the SLA clock actually
 * crossed the target (`computeBreachedAt`, run only over commitments whose
 * persisted status is already `"breached"`) — the same set the Breaches
 * Over Time chart plots.
 */
export async function getDashboardData(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date = new Date(),
): Promise<DashboardData> {
  return withPerfScope(
    "dashboard",
    () => getDashboardDataInner(prisma, organizationId, asOfDate),
    {
      organizationId,
    },
  );
}

async function getDashboardDataInner(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date,
): Promise<DashboardData> {
  const asOf = asOfDate.toISOString();
  const periodStart = new Date(asOfDate.getTime() - PERIOD_DAYS * 86_400_000);
  const previousPeriodStart = new Date(
    periodStart.getTime() - PERIOD_DAYS * 86_400_000,
  );

  const unmatchedCaseWhere = {
    organizationId,
    deletedAt: null,
    closedAt: null,
    commitments: { none: {} },
  } as const;
  const failedNotificationWhere = {
    commitment: { case: { organizationId, deletedAt: null } },
  } as const;
  // Every open commitment except cancelled ones — cancelled commitments
  // never appear on the At-Risk table and shouldn't crowd out real
  // candidates or count toward its overflow total.
  const atRiskWhere: Prisma.CommitmentWhereInput = {
    case: { organizationId, deletedAt: null },
    closedAt: null,
    status: { not: "cancelled" },
  };

  const [
    // Narrow, org-wide, zero-events reads: `Commitment.status`/`dueAt` only,
    // never `evaluateCommitment` (see performance-plan.md's "Snapshot vs
    // live" ground rule).
    // Per-kind tallies among every open commitment — a `groupBy`, not a
    // `findMany` + JS loop, so the row count this query moves is a handful
    // of (kind, status) buckets, not one row per open commitment (an org's
    // open set only grows over its lifetime, unlike the period-bounded
    // reads below).
    healthByKindGroups,
    // caseId + status for every open commitment, the minimum
    // `summarizeCompliance` (worst-status-per-case) needs — still one row
    // per open commitment, but two narrow columns instead of the full
    // commitment + joined case.
    openCommitmentStatusRows,
    // The open half of the breach-analytics candidate set: `status:
    // "breached"` is pushed into the query instead of fetched-then-filtered
    // — a small, bounded subset of the open set, not all of it.
    openBreachedCommitmentRows,
    currentPeriodClosedRows,
    previousPeriodClosedRows,
    organization,
    cycleTimeAnomalies,
    unmatchedCaseRows,
    unmatchedCaseCount,
    integrationRows,
    workerSettings,
    failedNotificationRows,
    failedNotificationCount,
    // The one bounded, live-evaluated exception (see AT_RISK_CANDIDATE_TAKE).
    atRiskCandidateRows,
    atRiskOverflowTotalCount,
  ] = await Promise.all([
    prisma.commitment.groupBy({
      by: ["kind", "status"],
      where: { case: { organizationId, deletedAt: null }, closedAt: null },
      _count: { _all: true },
    }),
    prisma.commitment.findMany({
      where: { case: { organizationId, deletedAt: null }, closedAt: null },
      select: { caseId: true, status: true },
    }),
    prisma.commitment.findMany({
      where: {
        case: { organizationId, deletedAt: null },
        closedAt: null,
        status: "breached",
      },
      select: {
        id: true,
        caseId: true,
        kind: true,
        cycleKey: true,
        status: true,
        startedAt: true,
        targetMinutes: true,
        dueAt: true,
        policyVersionId: true,
        calendarVersionId: true,
        case: { select: { openedAt: true } },
      },
    }),
    prisma.commitment.findMany({
      where: {
        case: { organizationId, deletedAt: null },
        closedAt: { gte: periodStart, lte: asOfDate },
        status: { in: ["met", "breached"] },
      },
      select: {
        id: true,
        caseId: true,
        kind: true,
        cycleKey: true,
        status: true,
        startedAt: true,
        targetMinutes: true,
        dueAt: true,
        policyVersionId: true,
        calendarVersionId: true,
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
      select: { name: true, timezone: true },
    }),
    getCycleTimeAnomalies(prisma, organizationId, asOfDate),
    // Phase 6.2: open cases the commitment pipeline never matched to any
    // policy — `commitments: { none: {} }` is the direct read of "the
    // pipeline's `continue` on no match left this case with zero rows".
    // Capped at the panel's display limit; `unmatchedCaseCount` carries the
    // true total for the overflow footer instead of loading every row.
    prisma.case.findMany({
      where: unmatchedCaseWhere,
      select: {
        id: true,
        externalId: true,
        subject: true,
        openedAt: true,
        customer: { select: { name: true } },
      },
      orderBy: { openedAt: "asc" },
      take: UNMATCHED_CASES_LIMIT,
    }),
    prisma.case.count({ where: unmatchedCaseWhere }),
    // Phase 6.3: every integration this organization has ever connected —
    // a provider with no row at all is onboarding's concern, not this panel's.
    prisma.integration.findMany({
      where: { organizationId },
      select: {
        provider: true,
        status: true,
        lastSyncAt: true,
        lastSyncError: true,
        lastSuccessfulSyncAt: true,
        failingSince: true,
      },
    }),
    getWorkerSettingsForRead(prisma),
    // Phase 6.4. Same cap-plus-count pattern as the unmatched-cases panel.
    prisma.notificationFailure.findMany({
      where: failedNotificationWhere,
      include: {
        commitment: {
          include: {
            case: { select: { id: true, externalId: true, subject: true } },
          },
        },
      },
      orderBy: { lastFailedAt: "desc" },
      take: FAILED_ALERTS_LIMIT,
    }),
    prisma.notificationFailure.count({ where: failedNotificationWhere }),
    prisma.commitment.findMany({
      where: atRiskWhere,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: AT_RISK_CANDIDATE_TAKE,
      include: { case: { include: { customer: true } } },
    }),
    prisma.commitment.count({ where: atRiskWhere }),
  ]);

  const timezone = organization?.timezone ?? "UTC";

  // Closed-in-period cases, for the "Total Escalated" cross-team aggregate
  // and the Attribution Ledger's period-scoped leg-hour totals (narrowed to
  // this period only, per performance-plan.md Phase 2 item 2 — an org-wide
  // scan of every currently-open case is the one thing this dashboard can't
  // afford, and there's no persisted per-case leg-time to read instead).
  const closedInPeriodCaseIds = [
    ...new Set(currentPeriodClosedRows.map((c) => c.caseId)),
  ];
  const closedCaseOpenedAtById = new Map<string, Date>(
    currentPeriodClosedRows
      .filter(
        (c): c is typeof c & { case: { openedAt: Date } } =>
          c.case?.openedAt != null,
      )
      .map((c) => [c.caseId, c.case.openedAt]),
  );

  const atRiskPolicyVersionIds = [
    ...new Set(atRiskCandidateRows.map((c) => c.policyVersionId)),
  ];
  const atRiskCalendarVersionIds = [
    ...new Set(atRiskCandidateRows.map((c) => c.calendarVersionId)),
  ];
  const atRiskCaseIds = [
    ...new Set(atRiskCandidateRows.map((c) => c.caseId)),
  ];
  // Events/links are needed for the at-risk candidates (live leg spans) and
  // the closed-in-period cases (Total Escalated / Attribution Ledger) —
  // both small, bounded sets, never "every case in the org".
  const eventCaseIds = [
    ...new Set([...atRiskCaseIds, ...closedInPeriodCaseIds]),
  ];

  const [policyVersionRows, calendarVersionRows, eventRows, caseLinkRows] =
    await Promise.all([
      atRiskPolicyVersionIds.length > 0
        ? prisma.sLAPolicyVersion.findMany({
            where: { id: { in: atRiskPolicyVersionIds } },
          })
        : Promise.resolve([]),
      atRiskCalendarVersionIds.length > 0
        ? prisma.businessCalendarVersion.findMany({
            where: { id: { in: atRiskCalendarVersionIds } },
          })
        : Promise.resolve([]),
      eventCaseIds.length > 0
        ? prisma.normalizedEvent.findMany({
            where: { caseId: { in: eventCaseIds } },
          })
        : Promise.resolve([]),
      eventCaseIds.length > 0
        ? prisma.caseLink.findMany({
            where: { caseId: { in: eventCaseIds }, unlinkedAt: null },
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
    perfCount("deriveLegSpans");
    legSpansByCaseId.set(caseId, spans);
    return spans;
  };

  // Phase 6.1: on-track/at-risk/breached per kind, among open commitments —
  // every kind starts at zero so a kind with nothing open still renders.
  // Persisted `status` only, never a live re-evaluation. `healthByKindGroups`
  // is already the grouped tally (performance-plan.md Phase 2 item 2:
  // "health-by-kind... from groupBy on persisted status"), so this just
  // reshapes it — no per-row loop over the open set.
  const healthByKindMap = new Map<
    CommitmentKind,
    { onTrack: number; atRisk: number; breached: number }
  >(
    COMMITMENT_KINDS.map((kind) => [
      kind,
      { onTrack: 0, atRisk: 0, breached: 0 },
    ]),
  );
  for (const group of healthByKindGroups) {
    const tally = healthByKindMap.get(group.kind);
    if (!tally) continue;
    if (group.status === "on_track") tally.onTrack += group._count._all;
    else if (group.status === "at_risk") tally.atRisk += group._count._all;
    else if (group.status === "breached") tally.breached += group._count._all;
  }
  const healthByKind: CommitmentKindHealth[] = COMMITMENT_KINDS.map((kind) => ({
    kind,
    ...(healthByKindMap.get(kind) ?? { onTrack: 0, atRisk: 0, breached: 0 }),
  }));

  // Breach-analytics candidates: only commitments whose *persisted* status is
  // already "breached" — `openBreachedCommitmentRows` already queried just
  // that subset (small and bounded, unlike the full open set), so no
  // client-side filter is needed here. `getProjectAnalytics` resolves each
  // candidate's true SLA-clock-crossing instant from persisted Evaluation
  // history (`getPersistedBreachedAt`), falling back to `dueAt` — not a live
  // `computeBreachedAt` re-run over every candidate's events.
  const breachCandidateRows: BreachCandidateRow[] = [
    ...openBreachedCommitmentRows.map((row) => ({
      ...row,
      closedAt: null,
      caseOpenedAt: row.case.openedAt,
    })),
    ...currentPeriodClosedRows
      .filter((row) => row.status === "breached")
      .map((row) => ({ ...row, caseOpenedAt: row.case.openedAt })),
  ];

  const atRisk: AtRiskRow[] = [];
  for (const row of atRiskCandidateRows) {
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
    perfCount("evaluateCommitment");
    if (
      evaluation.status !== "on_track" &&
      evaluation.status !== "at_risk" &&
      evaluation.status !== "breached"
    ) {
      continue;
    }

    const spans = legSpansFor(row.caseId, row.case.openedAt);
    const currentSpan = spans[spans.length - 1];
    const currentLeg: Leg = currentSpan?.leg ?? "unknown";
    const minutesInCurrentLeg = currentSpan
      ? Math.round(
          (asOfDate.getTime() - new Date(currentSpan.startedAt).getTime()) /
            60000,
        )
      : 0;
    const targetMinutes =
      policyVersion.targets.find((t) => t.kind === row.kind)?.minutes ?? 0;

    atRisk.push({
      commitmentId: row.id,
      caseId: row.caseId,
      externalId: row.case.externalId,
      subject: row.case.subject,
      customerName: row.case.customer?.name ?? null,
      requesterName: row.case.requesterName ?? null,
      kind: row.kind,
      remainingMinutes: evaluation.remainingMinutes,
      remainingSeconds: evaluation.remainingSeconds,
      clockState: evaluation.clock.state,
      effectiveDueAt: evaluation.effectiveDueAt,
      status: evaluation.status,
      currentLeg,
      minutesInCurrentLeg,
      priority: row.case.priority ?? null,
      tier: row.case.customer?.tier ?? row.case.tier ?? null,
      targetMinutes,
      supportLegMinutes: sumLegMinutes(spans, "support", asOf),
      engineeringLegMinutes: sumLegMinutes(spans, "engineering", asOf),
      linkedIssue: linkedIssueFor(row.caseId),
    });
  }
  atRisk.sort((a, b) => a.remainingMinutes - b.remainingMinutes);

  // "Breached (closed) in the prior 30-day period" — the same closed+status
  // rows already fetched for the previous-period compliance figure, read a
  // second way for the KPI tile's trend arrow. Not a re-derivation of
  // `findBreachesInPeriod` for the prior window: that would need its own
  // event/policy queries for a number that's only ever shown as a delta.
  const breachedPreviousPeriodCount = previousPeriodClosedRows.filter(
    (r) => r.status === "breached",
  ).length;

  // "Total Escalated" + the Attribution Ledger: derived over cases closed
  // within the period only (performance-plan.md Phase 2 item 2), using the
  // same `deriveLegSpans`/`sumLegMinutes` primitives as the rest of the page.
  let totalEscalatedCount = 0;
  let totalEscalatedLinkedCertain = 0;
  let supportLegMinutesTotal = 0;
  let engineeringLegMinutesTotal = 0;
  let waitingCustomerLegMinutesTotal = 0;
  for (const caseId of closedInPeriodCaseIds) {
    const caseOpenedAt = closedCaseOpenedAtById.get(caseId);
    if (!caseOpenedAt) continue;
    const spans = legSpansFor(caseId, caseOpenedAt);
    supportLegMinutesTotal += sumLegMinutes(spans, "support", asOf);
    engineeringLegMinutesTotal += sumLegMinutes(spans, "engineering", asOf);
    waitingCustomerLegMinutesTotal += sumLegMinutes(
      spans,
      "waiting_customer",
      asOf,
    );
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
    engineeringLegHours:
      Math.round((engineeringLegMinutesTotal / 60) * 10) / 10,
    waitingCustomerLegHours:
      Math.round((waitingCustomerLegMinutesTotal / 60) * 10) / 10,
    linkingPrecisionPercent:
      totalEscalatedCount > 0
        ? Math.round(
            (totalEscalatedLinkedCertain / totalEscalatedCount) * 1000,
          ) / 10
        : null,
    directMatches: totalEscalatedLinkedCertain,
    unlinkedOrStandalone: totalEscalatedCount - totalEscalatedLinkedCertain,
    auditTimestamp: asOf,
  };

  // A tracker or code host that was disconnected keeps the engineering time it
  // recorded; one that never existed means zero is "not measured" (N5.2). The
  // period totals above cover closed cases only, so a recorded link on any
  // case settles it; that read is skipped while a tracker is connected.
  const engineeringMeasured =
    integrationRows.some((row) => isIssueLinkSystem(row.provider) && row.status !== "disconnected") ||
    totalEscalatedCount > 0 ||
    engineeringLegMinutesTotal > 0 ||
    (await prisma.caseLink.findFirst({
      where: { case: { organizationId }, system: { in: ISSUE_LINK_PROVIDERS } },
      select: { id: true },
    })) !== null;

  const linkCoverage = await getLinkCoveragePanel(prisma, organizationId, asOfDate);

  const { analytics, breachedThisPeriod } = await getProjectAnalytics(
    prisma,
    periodStart,
    asOfDate,
    openCommitmentStatusRows,
    currentPeriodClosedRows,
    breachCandidateRows,
    timezone,
  );

  const unmatchedCases: UnmatchedCaseRow[] = unmatchedCaseRows.map((row) => ({
    caseId: row.id,
    externalId: row.externalId,
    subject: row.subject,
    customerName: row.customer?.name ?? null,
    openedAt: row.openedAt.toISOString(),
  }));

  // A disconnected integration is not expected to sync, so it is never "stale".
  const integrationHealth: IntegrationHealthRow[] = integrationRows.map(
    (row) => ({
      provider: row.provider as IntegrationProvider,
      reauthRequired: row.status === "reauth_required",
      permissionDenied: row.status === "permission_denied",
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastSyncError: row.lastSyncError,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
      failingSince: row.failingSince?.toISOString() ?? null,
      ...staleFields(row, asOf, workerSettings),
    }),
  );

  const failedAlerts: FailedAlertRow[] = failedNotificationRows
    .filter(
      (
        row,
      ): row is typeof row & {
        commitment: NonNullable<(typeof row)["commitment"]> & {
          case: NonNullable<(typeof row)["commitment"]["case"]>;
        };
      } => row.commitment?.case != null,
    )
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
    atRiskOverflowCount: Math.max(0, atRiskOverflowTotalCount - AT_RISK_LIMIT),
    breachedThisPeriod,
    breachedPreviousPeriodCount,
    totalEscalated,
    attributionLedger,
    engineeringMeasured,
    linkCoverage,
    compliance: {
      current: complianceOf(currentPeriodClosedRows),
      previous: complianceOf(previousPeriodClosedRows),
    },
    cycleTimeAnomalies,
    analytics,
    healthByKind,
    unmatchedCases,
    unmatchedOverflowCount: Math.max(
      0,
      unmatchedCaseCount - UNMATCHED_CASES_LIMIT,
    ),
    integrationHealth,
    failedAlerts,
    failedAlertsOverflowCount: Math.max(
      0,
      failedNotificationCount - FAILED_ALERTS_LIMIT,
    ),
  };
}
