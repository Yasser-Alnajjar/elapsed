import "server-only";
import { perfCount, withPerfScope, Prisma, type PrismaClient } from "@sla/db";
import {
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

import { formatPriorityTier } from "./format";
import type {
  AtRiskCounts,
  AtRiskLinkedIssue,
  AtRiskPageData,
  AtRiskParams,
  AtRiskRowData,
  AtRiskSeverityFilter,
  AtRiskThreatSample,
} from "./types/at-risk";

function minutesBetween(from: string, to: Date): number {
  return Math.round((to.getTime() - new Date(from).getTime()) / 60000);
}

const ISSUE_TRACKER_SYSTEMS: ("jira" | "linear" | "github")[] = [
  "jira",
  "linear",
  "github",
];

// Reverse of `PRIORITY_TIER_LABELS` (lib/format.ts) — mirrors
// `SEVERITY_RAW_PRIORITIES` in case-list-data.ts.
const SEVERITY_RAW_PRIORITIES: Record<
  Exclude<AtRiskSeverityFilter, "all">,
  string[]
> = {
  P1: ["urgent"],
  P2: ["high"],
  P3: ["normal"],
  P4: ["low"],
};

// A commitment counts as an at-risk candidate once it's open and not
// cancelled — met/cancelled commitments never appear here.
const OPEN_STATUSES: CommitmentStatus[] = ["on_track", "at_risk", "breached"];

/** remainingMinutes < 1h — mirrors the old client-side "Immediate Threat" tile threshold. */
export const IMMEDIATE_THREAT_MINUTES = 60;
/** 1h <= remainingMinutes < 2.5h — "Elevated Risk". */
export const ELEVATED_RISK_MINUTES = 150;
const THREAT_SAMPLE_SIZE = 3;

const DEFAULT_PARAMS: AtRiskParams = {
  page: 1,
  pageSize: 50,
  severity: "all",
  q: "",
};

/** Picks one active link to show per case — `certain` over `probable` when a case somehow carries both. Mirrors `dashboard-data.ts`'s `preferredLink`, kept local so this route's data shape stays decoupled from the dashboard reconstruction. */
function preferredLink(
  links: { system: string; externalId: string; confidence: string }[],
): AtRiskLinkedIssue | null {
  const trackerLinks = links.filter((l) => ISSUE_TRACKER_SYSTEMS.includes(l.system as any));
  if (trackerLinks.length === 0) return null;
  const best =
    trackerLinks.find((l) => l.confidence === "certain") ?? trackerLinks[0]!;
  return {
    system: best.system as AtRiskLinkedIssue["system"],
    externalId: best.externalId,
    confidence: best.confidence as AtRiskLinkedIssue["confidence"],
  };
}

/** Every open, non-cancelled at-risk/breached/on-track commitment for this org — the filter-independent base every "org-wide" count below shares. */
function baseWhere(organizationId: string): Prisma.CommitmentWhereInput {
  return {
    case: { organizationId, deletedAt: null },
    closedAt: null,
    status: { in: OPEN_STATUSES },
  };
}

/** `baseWhere` narrowed by the active severity/search filters — what the paginated page itself is scoped to. */
function candidateWhere(
  organizationId: string,
  params: Pick<AtRiskParams, "severity" | "q">,
): Prisma.CommitmentWhereInput {
  const caseWhere: Prisma.CaseWhereInput = { organizationId, deletedAt: null };

  if (params.severity !== "all") {
    caseWhere.priority = { in: SEVERITY_RAW_PRIORITIES[params.severity] };
  }

  const q = params.q.trim();
  if (q) {
    caseWhere.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { externalId: { contains: q, mode: "insensitive" } },
      { requesterName: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return {
    case: caseWhere,
    closedAt: null,
    status: { in: OPEN_STATUSES },
  };
}

type ThreatSampleRow = {
  case: { externalId: string; customer: { name: string } | null };
};

function toThreatSample(rows: ThreatSampleRow[]): AtRiskThreatSample[] {
  return rows.map((row) => ({
    externalId: row.case.externalId,
    customerName: row.case.customer?.name ?? null,
  }));
}

export async function getAtRiskData(
  prisma: PrismaClient,
  organizationId: string,
  params: Partial<AtRiskParams> = {},
  asOfDate: Date = new Date(),
): Promise<AtRiskPageData> {
  return withPerfScope(
    "at_risk",
    () =>
      getAtRiskDataInner(
        prisma,
        organizationId,
        { ...DEFAULT_PARAMS, ...params },
        asOfDate,
      ),
    { organizationId },
  );
}

async function getAtRiskDataInner(
  prisma: PrismaClient,
  organizationId: string,
  params: AtRiskParams,
  asOfDate: Date,
): Promise<AtRiskPageData> {
  const asOf = asOfDate.toISOString();
  const base = baseWhere(organizationId);
  const where = candidateWhere(organizationId, params);
  const skip = (params.page - 1) * params.pageSize;

  const immediateThreatCutoff = new Date(
    asOfDate.getTime() + IMMEDIATE_THREAT_MINUTES * 60_000,
  );
  const elevatedRiskCutoff = new Date(
    asOfDate.getTime() + ELEVATED_RISK_MINUTES * 60_000,
  );
  const immediateThreatWhere: Prisma.CommitmentWhereInput = {
    ...base,
    dueAt: { lt: immediateThreatCutoff },
  };
  const elevatedRiskWhere: Prisma.CommitmentWhereInput = {
    ...base,
    dueAt: { gte: immediateThreatCutoff, lt: elevatedRiskCutoff },
  };
  const linkedCertainWhere: Prisma.CommitmentWhereInput = {
    ...base,
    case: {
      ...(base.case as Prisma.CaseWhereInput),
      caseLinks: {
        some: {
          unlinkedAt: null,
          confidence: "certain",
          system: { in: ISSUE_TRACKER_SYSTEMS },
        },
      },
    },
  };

  const [
    // Paginated, live-evaluated candidate page — the one bounded exception
    // to "never evaluate the whole open set" (performance-plan.md Phase 2
    // item 4).
    candidateRows,
    rowCount,
    // Everything below is org-wide and filter-independent (same `getCounts`
    // pattern as case-list-data.ts): persisted-field counts/narrow selects
    // only, no events, no evaluation.
    totalCount,
    breachedCount,
    linkedCertainCount,
    immediateThreatCount,
    immediateThreatSampleRows,
    elevatedRiskCount,
    elevatedRiskSampleRows,
    severityRows,
  ] = await Promise.all([
    prisma.commitment.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      skip,
      take: params.pageSize,
      include: { case: { include: { customer: true } } },
    }),
    prisma.commitment.count({ where }),
    prisma.commitment.count({ where: base }),
    prisma.commitment.count({ where: { ...base, status: "breached" } }),
    prisma.commitment.count({ where: linkedCertainWhere }),
    prisma.commitment.count({ where: immediateThreatWhere }),
    prisma.commitment.findMany({
      where: immediateThreatWhere,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: THREAT_SAMPLE_SIZE,
      select: { case: { select: { externalId: true, customer: { select: { name: true } } } } },
    }),
    prisma.commitment.count({ where: elevatedRiskWhere }),
    prisma.commitment.findMany({
      where: elevatedRiskWhere,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: THREAT_SAMPLE_SIZE,
      select: { case: { select: { externalId: true, customer: { select: { name: true } } } } },
    }),
    // Commitment carries no `priority` of its own to `groupBy` on, and
    // Prisma can't group by a related model's field — so this tallies in JS
    // from a narrow, event-free scan instead of a single SQL aggregation.
    prisma.commitment.findMany({
      where: base,
      select: { case: { select: { priority: true } } },
    }),
  ]);

  const rows =
    candidateRows.length === 0
      ? []
      : await evaluateCandidatePage(prisma, candidateRows, asOf, asOfDate);

  return {
    asOf,
    rows,
    page: params.page,
    pageSize: params.pageSize,
    pageCount: Math.max(1, Math.ceil(rowCount / params.pageSize)),
    rowCount,
    totalCount,
    breachedCount,
    linkedCertainCount,
    immediateThreatCount,
    immediateThreatSample: toThreatSample(immediateThreatSampleRows as ThreatSampleRow[]),
    elevatedRiskCount,
    elevatedRiskSample: toThreatSample(elevatedRiskSampleRows as ThreatSampleRow[]),
    counts: buildSeverityCounts(severityRows as { case: { priority: string | null } }[], totalCount),
  };
}

type CandidateRow = Prisma.CommitmentGetPayload<{
  include: { case: { include: { customer: true } } };
}>;

/** Live-evaluates exactly this page's candidates — never the whole open set. */
async function evaluateCandidatePage(
  prisma: PrismaClient,
  candidateRows: CandidateRow[],
  asOf: string,
  asOfDate: Date,
): Promise<AtRiskRowData[]> {
  const policyVersionIds = [
    ...new Set(candidateRows.map((commitment) => commitment.policyVersionId)),
  ];
  const calendarVersionIds = [
    ...new Set(candidateRows.map((commitment) => commitment.calendarVersionId)),
  ];
  const caseIds = [...new Set(candidateRows.map((commitment) => commitment.caseId))];

  const [policyVersionRows, calendarVersionRows, eventRows, caseLinkRows] =
    await Promise.all([
      prisma.sLAPolicyVersion.findMany({ where: { id: { in: policyVersionIds } } }),
      prisma.businessCalendarVersion.findMany({
        where: { id: { in: calendarVersionIds } },
      }),
      prisma.normalizedEvent.findMany({ where: { caseId: { in: caseIds } } }),
      // Same "active relationship" filter as case-detail-data.ts's `links`.
      prisma.caseLink.findMany({
        where: { caseId: { in: caseIds }, unlinkedAt: null },
      }),
    ]);

  const linksByCaseId = new Map<
    string,
    { system: string; externalId: string; confidence: string }[]
  >();
  for (const link of caseLinkRows) {
    const existing = linksByCaseId.get(link.caseId);
    if (existing) existing.push(link);
    else linksByCaseId.set(link.caseId, [link]);
  }
  const linkedIssueFor = (caseId: string): AtRiskLinkedIssue | null =>
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
    const event = toNormalizedEventDomain(row);
    const existing = eventsByCaseId.get(row.caseId);
    if (existing) existing.push(event);
    else eventsByCaseId.set(row.caseId, [event]);
  }

  const legSpansByCaseId = new Map<string, LegSpan[]>();
  const getLegSpans = (caseId: string, caseOpenedAt: Date): LegSpan[] => {
    const cached = legSpansByCaseId.get(caseId);
    if (cached) return cached;
    const { spans } = deriveLegSpans(eventsByCaseId.get(caseId) ?? [], {
      caseOpenedAt: caseOpenedAt.toISOString(),
    });
    perfCount("deriveLegSpans");
    legSpansByCaseId.set(caseId, spans);
    return spans;
  };

  const rows: AtRiskRowData[] = [];

  // Live-evaluated, in DB (`dueAt, id`) order — the same order the UI
  // advertises to the user. A row is dropped only when the live status has
  // since drifted off this page's snapshot filter (performance-plan.md's
  // ~5-minute worker staleness window), never re-sorted by live
  // `remainingMinutes`.
  for (const row of candidateRows) {
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

    const spans = getLegSpans(row.caseId, row.case.openedAt);
    const currentSpan = spans[spans.length - 1];
    const currentLeg: Leg = currentSpan?.leg ?? "unknown";
    const minutesInCurrentLeg = currentSpan
      ? minutesBetween(currentSpan.startedAt, asOfDate)
      : 0;
    const targetMinutes =
      policyVersion.targets.find((t) => t.kind === row.kind)?.minutes ?? 0;

    rows.push({
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
      elapsedSeconds: evaluation.elapsedSeconds,
      supportLegMinutes: sumLegMinutes(spans, "support", asOf),
      engineeringLegMinutes: sumLegMinutes(spans, "engineering", asOf),
      waitingCustomerLegMinutes: sumLegMinutes(spans, "waiting_customer", asOf),
      supportAssigneeName: row.case.assigneeName ?? null,
      linkedIssue: linkedIssueFor(row.caseId),
    });
  }

  return rows;
}

function buildSeverityCounts(
  severityRows: { case: { priority: string | null } }[],
  totalCount: number,
): AtRiskCounts {
  const severity: AtRiskCounts["severity"] = {
    all: totalCount,
    P1: 0,
    P2: 0,
    P3: 0,
    P4: 0,
  };
  for (const row of severityRows) {
    const tier = formatPriorityTier(row.case.priority) as
      | Exclude<AtRiskSeverityFilter, "all">
      | null;
    if (tier) severity[tier] += 1;
  }
  return { severity };
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function parseAtRiskParams(
  searchParams: Record<string, string | string[] | undefined>,
): AtRiskParams {
  const get = (key: string): string | undefined => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const page = Math.max(1, Number(get("page")) || 1);
  const pageSizeRaw = Number(get("pageSize"));
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeRaw) ? pageSizeRaw : 50;
  const severity = (get("severity") as AtRiskSeverityFilter) ?? "all";
  const q = get("q") ?? "";

  return { page, pageSize, severity, q };
}
