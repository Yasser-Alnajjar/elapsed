import "server-only";
import { withPerfScope, Prisma, type PrismaClient } from "@sla/db";
import type { CommitmentKind, CommitmentStatus } from "@sla/core";
import { formatPriorityTier } from "./format";
import type {
  CaseListCounts,
  CaseListData,
  CaseListLinkFilter,
  CaseListOpenFilter,
  CaseListParams,
  CaseListRow,
  CaseListSeverityFilter,
  CaseListSortId,
  CaseListStatusFilter,
} from "./types/cases";

// Precedence for picking one representative status out of a case's several
// commitments — worst-first, so a single breached commitment surfaces even
// if another commitment on the same case has already been met.
const STATUS_PRECEDENCE: CommitmentStatus[] = [
  "breached",
  "at_risk",
  "on_track",
  "met",
  "cancelled",
];

function worstStatus(statuses: CommitmentStatus[]): CommitmentStatus | null {
  if (statuses.length === 0) return null;
  return (
    STATUS_PRECEDENCE.find((status) => statuses.includes(status)) ??
    statuses[0] ??
    null
  );
}

function worstOf<T extends { status: CommitmentStatus }>(rows: T[]): T | undefined {
  return [...rows].sort(
    (a, b) =>
      STATUS_PRECEDENCE.indexOf(a.status) - STATUS_PRECEDENCE.indexOf(b.status),
  )[0];
}

const LINK_SYSTEMS: Array<"jira" | "linear" | "github"> = [
  "jira",
  "linear",
  "github",
];

// Reverse of `PRIORITY_TIER_LABELS` (lib/format.ts) — the raw ticket
// priority strings that map to each Stitch severity tier.
const SEVERITY_RAW_PRIORITIES: Record<Exclude<CaseListSeverityFilter, "all">, string[]> =
  {
    P1: ["urgent"],
    P2: ["high"],
    P3: ["normal"],
    P4: ["low"],
  };

// Only columns with a real, persisted, monotonic value are sortable
// server-side. Maps a case-list column id (csr/columns.tsx) to the Prisma
// field it sorts by. "slaTargetRunway"/"legAllocation"/"correlation" are
// excluded: their values are either derived from live evaluation (no
// persisted equivalent) or a to-many relation (link confidence) — see
// performance-plan.md Phase 2 item 1.
const SORT_COLUMNS: Record<CaseListSortId, string> = {
  priorityDualKey: "externalId",
  subject: "subject",
  currentStateAssignee: "assigneeName",
};

function buildWhere(
  organizationId: string,
  params: Pick<
    CaseListParams,
    "status" | "openState" | "linkState" | "severity" | "q"
  >,
): Prisma.CaseWhereInput {
  const where: Prisma.CaseWhereInput = {
    organizationId,
    deletedAt: null,
  };

  if (params.openState === "open") where.closedAt = null;
  else if (params.openState === "closed") where.closedAt = { not: null };

  if (params.linkState === "linked") {
    where.caseLinks = {
      some: { unlinkedAt: null, system: { in: LINK_SYSTEMS } },
    };
  } else if (params.linkState === "unlinked") {
    where.caseLinks = {
      none: { unlinkedAt: null, system: { in: LINK_SYSTEMS } },
    };
  }

  // Approximates `worstCommitmentStatus`: "has a commitment at this status",
  // not "this is the case's single worst status" (that precedence isn't a
  // persisted column). A case with both an at_risk and a breached
  // commitment would match both the "At Risk" and "Breached" chips — an
  // accepted tradeoff for a chip filter, same one the plan's own
  // filter-chip-count bullet implies by asking for a `groupBy` instead of a
  // precedence computation.
  if (params.status !== "all") {
    where.commitments = { some: { status: params.status } };
  }

  if (params.severity !== "all") {
    where.priority = { in: SEVERITY_RAW_PRIORITIES[params.severity] };
  }

  const q = params.q.trim();
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { externalId: { contains: q, mode: "insensitive" } },
      { requesterName: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function buildOrderBy(
  sort: CaseListParams["sort"],
): Prisma.CaseOrderByWithRelationInput[] {
  const column = sort ? SORT_COLUMNS[sort.id] : "openedAt";
  const direction: Prisma.SortOrder = sort ? (sort.desc ? "desc" : "asc") : "desc";
  return [{ [column]: direction }, { id: "asc" }];
}

async function getCounts(
  prisma: PrismaClient,
  organizationId: string,
): Promise<CaseListCounts> {
  const base = { organizationId, deletedAt: null } as const;
  const statusValues: CommitmentStatus[] = [
    "breached",
    "at_risk",
    "on_track",
    "met",
    "cancelled",
  ];
  const [
    total,
    statusCounts,
    openCount,
    closedCount,
    linkedCount,
    linkedCertainCount,
    runningClockCount,
    priorityGroups,
  ] = await Promise.all([
    prisma.case.count({ where: base }),
    Promise.all(
      statusValues.map((status) =>
        prisma.case.count({
          where: { ...base, commitments: { some: { status } } },
        }),
      ),
    ),
    prisma.case.count({ where: { ...base, closedAt: null } }),
    prisma.case.count({ where: { ...base, closedAt: { not: null } } }),
    prisma.case.count({
      where: {
        ...base,
        caseLinks: { some: { unlinkedAt: null, system: { in: LINK_SYSTEMS } } },
      },
    }),
    prisma.case.count({
      where: {
        ...base,
        caseLinks: {
          some: {
            unlinkedAt: null,
            system: { in: LINK_SYSTEMS },
            confidence: "certain",
          },
        },
      },
    }),
    prisma.case.count({
      where: { ...base, commitments: { some: { closedAt: null } } },
    }),
    prisma.case.groupBy({
      by: ["priority"],
      where: base,
      _count: true,
    }),
  ]);

  const status: CaseListCounts["status"] = { all: total } as CaseListCounts["status"];
  statusValues.forEach((s, i) => {
    status[s] = statusCounts[i]!;
  });

  const severity: CaseListCounts["severity"] = {
    all: total,
    P1: 0,
    P2: 0,
    P3: 0,
    P4: 0,
  };
  for (const group of priorityGroups as { priority: string | null; _count: number }[]) {
    const tier = formatPriorityTier(group.priority) as
      | Exclude<CaseListSeverityFilter, "all">
      | null;
    if (tier) severity[tier] += group._count;
  }

  return {
    status,
    open: { all: total, open: openCount, closed: closedCount },
    link: { all: total, linked: linkedCount, unlinked: total - linkedCount },
    severity,
    runningClock: runningClockCount,
    linkedCertain: linkedCertainCount,
  };
}

const DEFAULT_PARAMS: CaseListParams = {
  page: 1,
  pageSize: 25,
  sort: null,
  status: "all",
  openState: "all",
  linkState: "all",
  severity: "all",
  q: "",
};

/**
 * Server-paginated, snapshot-only case list (performance-plan.md Phase 2
 * item 1). Unlike the old implementation, this never loads events and never
 * calls `evaluateCommitment`/`deriveLegSpans` — `liveCommitment`/
 * `settledCommitment` are derived from persisted `Commitment` fields and the
 * latest `Evaluation` row.
 *
 * Pass `params.pageSize` as `undefined` to fetch every row matching the
 * current filters with no `skip`/`take` — used by the CSV export route,
 * which is cheap now that the query no longer evaluates.
 */
export async function getCaseListData(
  prisma: PrismaClient,
  organizationId: string,
  params: Partial<CaseListParams> = {},
  asOfDate: Date = new Date(),
): Promise<CaseListData> {
  return withPerfScope(
    "case_list",
    () =>
      getCaseListDataInner(
        prisma,
        organizationId,
        { ...DEFAULT_PARAMS, ...params },
        asOfDate,
      ),
    { organizationId },
  );
}

async function getCaseListDataInner(
  prisma: PrismaClient,
  organizationId: string,
  params: CaseListParams,
  asOfDate: Date,
): Promise<CaseListData> {
  const asOf = asOfDate.toISOString();
  const where = buildWhere(organizationId, params);
  const orderBy = buildOrderBy(params.sort);
  const unbounded = !Number.isFinite(params.pageSize) || params.pageSize <= 0;
  const skip = unbounded ? undefined : (params.page - 1) * params.pageSize;
  const take = unbounded ? undefined : params.pageSize;

  const [rows, rowCount, counts] = await Promise.all([
    prisma.case.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        customer: { select: { name: true } },
        commitments: {
          select: {
            id: true,
            kind: true,
            status: true,
            targetMinutes: true,
            startedAt: true,
            dueAt: true,
            closedAt: true,
          },
        },
        caseLinks: {
          where: { unlinkedAt: null, system: { in: LINK_SYSTEMS } },
          select: {
            system: true,
            externalId: true,
            confidence: true,
            evidence: true,
          },
          take: 1,
        },
      },
    }),
    prisma.case.count({ where }),
    getCounts(prisma, organizationId),
  ]);

  // Latest persisted Evaluation per closed/settled commitment on this page
  // only — never a live re-run (report-data.ts uses the same pattern for
  // closed commitments).
  const closedCommitmentIds = rows.flatMap((row) =>
    row.commitments
      .filter((c) => c.closedAt !== null)
      .map((c) => c.id),
  );
  const latestEvaluationByCommitmentId = new Map<
    string,
    { elapsedSeconds: number }
  >();
  if (closedCommitmentIds.length > 0) {
    const evaluationRows = await prisma.evaluation.findMany({
      where: { commitmentId: { in: closedCommitmentIds } },
      orderBy: { evaluatedAt: "desc" },
      select: { commitmentId: true, elapsedSeconds: true },
    });
    for (const evaluation of evaluationRows) {
      if (!latestEvaluationByCommitmentId.has(evaluation.commitmentId)) {
        latestEvaluationByCommitmentId.set(evaluation.commitmentId, evaluation);
      }
    }
  }

  const cases: CaseListRow[] = rows.map((row) => {
    const link = row.caseLinks[0];
    const openCommitments = row.commitments.filter((c) => c.closedAt === null);
    const openWorst = worstOf(openCommitments);

    let liveCommitment: CaseListRow["liveCommitment"] = null;
    let settledCommitment: CaseListRow["settledCommitment"] = null;

    if (openWorst) {
      liveCommitment = {
        kind: openWorst.kind as CommitmentKind,
        status: openWorst.status,
        targetMinutes: openWorst.targetMinutes,
        remainingMinutes: Math.round(
          (openWorst.dueAt.getTime() - asOfDate.getTime()) / 60_000,
        ),
        elapsedSeconds: Math.max(
          0,
          (asOfDate.getTime() - openWorst.startedAt.getTime()) / 1000,
        ),
      };
    } else if (row.commitments.length > 0) {
      const worst = worstOf(row.commitments)!;
      const evaluation = latestEvaluationByCommitmentId.get(worst.id);
      settledCommitment = {
        kind: worst.kind as CommitmentKind,
        status: worst.status,
        targetMinutes: worst.targetMinutes,
        elapsedSeconds: evaluation?.elapsedSeconds ?? null,
      };
    }

    return {
      caseId: row.id,
      externalId: row.externalId,
      subject: row.subject,
      customerName: row.customer?.name ?? null,
      requesterName: row.requesterName ?? null,
      priority: row.priority,
      tier: row.tier,
      channel: row.channel,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      worstCommitmentStatus: worstStatus(row.commitments.map((c) => c.status)),
      assigneeName: row.assigneeName,
      primaryLink: link
        ? {
            system: link.system as "jira" | "linear" | "github",
            externalId: link.externalId,
            confidence: link.confidence as "certain" | "probable",
            statusName:
              (link.evidence as { statusName?: string } | null)?.statusName ??
              null,
          }
        : null,
      liveCommitment,
      settledCommitment,
    };
  });

  const pageSize = unbounded ? rowCount || 1 : params.pageSize;

  return {
    asOf,
    cases,
    page: params.page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(rowCount / pageSize)),
    rowCount,
    counts,
  };
}

export function parseCaseListParams(
  searchParams: Record<string, string | string[] | undefined>,
): CaseListParams {
  const get = (key: string): string | undefined => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const page = Math.max(1, Number(get("page")) || 1);
  const pageSizeRaw = Number(get("pageSize"));
  const pageSize = [10, 25, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 25;

  const sortId = get("sort") as CaseListSortId | undefined;
  const sort =
    sortId && sortId in SORT_COLUMNS
      ? { id: sortId, desc: get("dir") !== "asc" }
      : null;

  const status = (get("status") as CaseListStatusFilter) ?? "all";
  const openState = (get("openState") as CaseListOpenFilter) ?? "all";
  const linkState = (get("linkState") as CaseListLinkFilter) ?? "all";
  const severity = (get("severity") as CaseListSeverityFilter) ?? "all";
  const q = get("q") ?? "";

  return { page, pageSize, sort, status, openState, linkState, severity, q };
}
