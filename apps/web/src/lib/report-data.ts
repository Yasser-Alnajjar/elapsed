import { perfCount, Prisma, type PrismaClient } from "@sla/db";
import {
  evaluateCommitment,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type CommitmentStatus,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { toCommitmentDomain, toNormalizedEventDomain } from "@sla/commitments";
import type { ZendeskCredentials } from "@sla/zendesk";
import type { JiraCredentials } from "@sla/jira";
import { buildCsvHeaderLine, buildCsvRowLines } from "./csv";
import {
  formatCommitmentKind,
  formatCommitmentStatus,
  formatMinutes,
} from "./format";

export interface ComplianceReportRow {
  customerName: string;
  externalId: string;
  zendeskUrl: string | null;
  jiraIssueKeys: string[];
  linearIssueKeys: string[];
  githubPullRequestKeys: string[];
  kind: CommitmentKind;
  status: CommitmentStatus;
  targetMinutes: number;
  elapsedWorkingMinutes: number | null;
  breachedByMinutes: number | null;
  openedAt: string;
  dueAt: string;
  closedAt: string | null;
}

const DEFAULT_BATCH_SIZE = 1000;

// Only the columns `toRow` actually reads (performance-plan.md Phase 2 item
// 5) — the previous version pulled every Commitment/Case/Customer/CaseLink
// column for the whole org in one shot.
const COMMITMENT_SELECT = {
  id: true,
  caseId: true,
  kind: true,
  cycleKey: true,
  policyVersionId: true,
  calendarVersionId: true,
  startedAt: true,
  targetMinutes: true,
  dueAt: true,
  status: true,
  closedAt: true,
  case: {
    select: {
      openedAt: true,
      externalId: true,
      system: true,
      customer: { select: { name: true } },
      caseLinks: { select: { system: true, externalId: true } },
    },
  },
} satisfies Prisma.CommitmentSelect;

type CommitmentBatchRow = Prisma.CommitmentGetPayload<{
  select: typeof COMMITMENT_SELECT;
}>;

const POLICY_VERSION_SELECT = {
  id: true,
  policyId: true,
  version: true,
  match: true,
  targets: true,
  pauseOnStates: true,
  calendarVersionId: true,
  warnAtPercent: true,
  effectiveFrom: true,
} satisfies Prisma.SLAPolicyVersionSelect;

const CALENDAR_VERSION_SELECT = {
  id: true,
  version: true,
  timezone: true,
  weekly: true,
  holidays: true,
  alwaysOpen: true,
} satisfies Prisma.BusinessCalendarVersionSelect;

const NORMALIZED_EVENT_SELECT = {
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
} satisfies Prisma.NormalizedEventSelect;

interface ReportCursor {
  openedAt: Date;
  id: string;
}

/**
 * Every commitment in the organization — open and closed — for the CSV
 * export (the reporting floor, Phase 10), in `(case.openedAt, id)` descending
 * keyset-paginated batches of `batchSize` (performance-plan.md Phase 2 item
 * 5). Closed commitments read their elapsed/status from the last persisted
 * `Evaluation` (the final snapshot the worker recorded when the case closed)
 * rather than re-running the engine, since that snapshot *is* what actually
 * happened; open ones are evaluated live, same as the dashboard, so an
 * export taken mid-cycle isn't stale. Each batch only loads the policy
 * versions, calendars, events and evaluations that batch's own commitments
 * reference — never the whole org's.
 */
export async function* iterateComplianceReportRows(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date = new Date(),
  batchSize: number = DEFAULT_BATCH_SIZE,
): AsyncGenerator<ComplianceReportRow[]> {
  const asOf = asOfDate.toISOString();

  const [zendeskIntegration, jiraIntegration] = await Promise.all([
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
  ]);
  const zendeskCredentials =
    (zendeskIntegration?.credentials as ZendeskCredentials | null) ?? null;
  // Fetched for parity with the pre-batching version, which also never used
  // it — no jiraUrl field exists on ComplianceReportRow, only jiraIssueKeys.
  void ((jiraIntegration?.credentials as JiraCredentials | null) ?? null);

  let cursor: ReportCursor | null = null;
  for (;;) {
    const commitmentRows: CommitmentBatchRow[] = await prisma.commitment.findMany({
      where: {
        case: { organizationId, deletedAt: null },
        ...(cursor
          ? {
              OR: [
                { case: { openedAt: { lt: cursor.openedAt } } },
                { case: { openedAt: cursor.openedAt }, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ case: { openedAt: "desc" } }, { id: "desc" }],
      take: batchSize,
      select: COMMITMENT_SELECT,
    });

    if (commitmentRows.length === 0) return;

    yield await toReportRows(prisma, commitmentRows, zendeskCredentials, asOf);

    if (commitmentRows.length < batchSize) return;
    const last = commitmentRows[commitmentRows.length - 1]!;
    cursor = { openedAt: last.case.openedAt, id: last.id };
  }
}

/** Collects every batch — for callers (tests, the tenant-isolation suite) that want the full set rather than a stream. */
export async function getComplianceReportRows(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date = new Date(),
): Promise<ComplianceReportRow[]> {
  const rows: ComplianceReportRow[] = [];
  for await (const batch of iterateComplianceReportRows(
    prisma,
    organizationId,
    asOfDate,
  )) {
    rows.push(...batch);
  }
  return rows;
}

async function toReportRows(
  prisma: PrismaClient,
  commitmentRows: CommitmentBatchRow[],
  zendeskCredentials: ZendeskCredentials | null,
  asOf: string,
): Promise<ComplianceReportRow[]> {
  const openCommitmentRows = commitmentRows.filter((c) => c.closedAt === null);
  const closedCommitmentRows = commitmentRows.filter(
    (c) => c.closedAt !== null,
  );

  const policyVersionIds = [
    ...new Set(openCommitmentRows.map((c) => c.policyVersionId)),
  ];
  const calendarVersionIds = [
    ...new Set(openCommitmentRows.map((c) => c.calendarVersionId)),
  ];
  const caseIds = [...new Set(openCommitmentRows.map((c) => c.caseId))];

  const [
    policyVersionRows,
    calendarVersionRows,
    eventRows,
    latestEvaluationRows,
  ] = await Promise.all([
    policyVersionIds.length > 0
      ? prisma.sLAPolicyVersion.findMany({
          where: { id: { in: policyVersionIds } },
          select: POLICY_VERSION_SELECT,
        })
      : Promise.resolve([]),
    calendarVersionIds.length > 0
      ? prisma.businessCalendarVersion.findMany({
          where: { id: { in: calendarVersionIds } },
          select: CALENDAR_VERSION_SELECT,
        })
      : Promise.resolve([]),
    caseIds.length > 0
      ? prisma.normalizedEvent.findMany({
          where: { caseId: { in: caseIds } },
          select: NORMALIZED_EVENT_SELECT,
        })
      : Promise.resolve([]),
    closedCommitmentRows.length > 0
      ? prisma.evaluation.findMany({
          where: {
            commitmentId: { in: closedCommitmentRows.map((c) => c.id) },
          },
          // One row per commitment — its latest evaluation — instead of
          // every evaluation ever recorded for it, the same
          // `distinct` + matching `orderBy` pattern as
          // `runEvaluationPipeline`'s `latestEvaluationRows`
          // (packages/commitments/src/evaluate-pipeline.ts).
          distinct: ["commitmentId"],
          orderBy: [{ commitmentId: "asc" }, { evaluatedAt: "desc" }],
          select: {
            commitmentId: true,
            status: true,
            elapsedSeconds: true,
            breachedBySeconds: true,
          },
        })
      : Promise.resolve([]),
  ]);

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

  const eventsByCaseId = new Map<
    string,
    ReturnType<typeof toNormalizedEventDomain>[]
  >();
  for (const row of eventRows) {
    const domainEvent = toNormalizedEventDomain(row);
    const existing = eventsByCaseId.get(row.caseId);
    if (existing) existing.push(domainEvent);
    else eventsByCaseId.set(row.caseId, [domainEvent]);
  }

  const latestEvaluationByCommitmentId = new Map(
    latestEvaluationRows.map((row) => [row.commitmentId, row]),
  );

  function toRow(row: CommitmentBatchRow): ComplianceReportRow {
    const jiraIssueKeys = row.case.caseLinks
      .filter((l) => l.system === "jira")
      .map((l) => l.externalId);
    const linearIssueKeys = row.case.caseLinks
      .filter((l) => l.system === "linear")
      .map((l) => l.externalId);
    const githubPullRequestKeys = row.case.caseLinks
      .filter((l) => l.system === "github")
      .map((l) => l.externalId);
    // Gated on row.case.system (roadmap step 22), not just "is Zendesk
    // connected" — see case-detail-data.ts for why. Intercom-sourced rows
    // get no outbound link here (same gap @sla/linear already has).
    const zendeskUrl =
      zendeskCredentials && row.case.system === "zendesk"
        ? `https://${zendeskCredentials.subdomain}.zendesk.com/agent/tickets/${row.case.externalId}`
        : null;

    const base = {
      customerName: row.case.customer?.name ?? "Unknown account",
      externalId: row.case.externalId,
      zendeskUrl,
      jiraIssueKeys,
      linearIssueKeys,
      githubPullRequestKeys,
      kind: row.kind,
      targetMinutes: row.targetMinutes,
      openedAt: row.case.openedAt.toISOString(),
      dueAt: row.dueAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    };

    if (row.closedAt) {
      const evaluation = latestEvaluationByCommitmentId.get(row.id);
      return {
        ...base,
        status: evaluation?.status ?? row.status,
        elapsedWorkingMinutes: evaluation
          ? evaluation.elapsedSeconds / 60
          : null,
        breachedByMinutes:
          evaluation?.breachedBySeconds != null
            ? evaluation.breachedBySeconds / 60
            : null,
      };
    }

    const policyVersion = policyVersionsById.get(row.policyVersionId);
    const calendar = calendarsById.get(row.calendarVersionId);
    if (!policyVersion || !calendar) {
      return {
        ...base,
        status: row.status,
        elapsedWorkingMinutes: null,
        breachedByMinutes: null,
      };
    }
    const events = eventsByCaseId.get(row.caseId) ?? [];
    const evaluation = evaluateCommitment(
      toCommitmentDomain(row),
      events,
      policyVersion,
      calendar,
      asOf,
    );
    perfCount("evaluateCommitment");
    return {
      ...base,
      status: evaluation.status,
      elapsedWorkingMinutes: evaluation.elapsedWorkingMinutes,
      breachedByMinutes: evaluation.breachedByMinutes ?? null,
    };
  }

  return commitmentRows.map(toRow);
}

export const COMPLIANCE_REPORT_CSV_HEADER = [
  "Customer",
  "Ticket",
  "Zendesk URL",
  "Jira issues",
  "Linear issues",
  "GitHub pull requests",
  "Commitment",
  "Status",
  "Target",
  "Elapsed",
  "Breached by",
  "Opened at",
  "Due at",
  "Closed at",
];

function toCsvRow(row: ComplianceReportRow): (string | number | null)[] {
  return [
    row.customerName,
    row.externalId,
    row.zendeskUrl,
    row.jiraIssueKeys.join(" "),
    row.linearIssueKeys.join(" "),
    row.githubPullRequestKeys.join(" "),
    formatCommitmentKind(row.kind),
    formatCommitmentStatus(row.status),
    formatMinutes(row.targetMinutes),
    row.elapsedWorkingMinutes !== null
      ? formatMinutes(row.elapsedWorkingMinutes)
      : "",
    row.breachedByMinutes !== null ? formatMinutes(row.breachedByMinutes) : "",
    row.openedAt,
    row.dueAt,
    row.closedAt,
  ];
}

/** Header line only — for a streaming response that appends body lines batch by batch. */
export function complianceReportCsvHeaderLine(): string {
  return buildCsvHeaderLine(COMPLIANCE_REPORT_CSV_HEADER);
}

/** Body lines for one batch of rows, no header — for a streaming response. */
export function complianceReportRowsToCsvLines(
  rows: ComplianceReportRow[],
): string {
  return buildCsvRowLines(rows.map(toCsvRow));
}

/** Full CSV (header + every row) from an already-collected row set — used by tests and any non-streaming caller. */
export function complianceReportToCsv(rows: ComplianceReportRow[]): string {
  return complianceReportCsvHeaderLine() + complianceReportRowsToCsvLines(rows);
}

/**
 * One JSON-array chunk for a streaming response: every row in this batch,
 * comma-joined, with a leading comma unless `isFirstBatch` (i.e. this is the
 * first non-empty batch written to the stream) — so batches concatenate
 * into one valid top-level JSON array without the caller tracking a
 * per-row index. `iterateComplianceReportRows` never yields an empty batch,
 * so every call with a non-empty `rows` toggles the caller's "first" flag.
 */
export function complianceReportRowsToJsonChunk(
  rows: ComplianceReportRow[],
  isFirstBatch: boolean,
): string {
  if (rows.length === 0) return "";
  const body = rows.map((row) => JSON.stringify(row)).join(",");
  return isFirstBatch ? body : `,${body}`;
}

/** Full JSON array from an already-collected row set — used by tests and any non-streaming caller. */
export function complianceReportToJson(rows: ComplianceReportRow[]): string {
  return `[${complianceReportRowsToJsonChunk(rows, true)}]`;
}
