import { perfCount, Prisma, type PrismaClient } from "@sla/db";
import {
  deriveLegSpans,
  legAtTime,
  localDateKey,
  type CommitmentKind,
  type CommitmentStatus,
  type Leg,
  type NormalizedEvent,
} from "@sla/core";
import { toNormalizedEventDomain, type CommitmentRecord } from "@sla/commitments";
import type {
  BreachedThisPeriodSummary,
  BreachesByStageRow,
  BreachesOverTimeLegPoint,
  BreachesOverTimePoint,
  ComplianceTrendPoint,
  ProjectAnalyticsData,
  SlaComplianceBreakdown,
} from "./types/dashboard";

// Default kept as the historical behavior (bare UTC-slice callers, and
// every existing test) for any caller that doesn't pass a timezone.
const DEFAULT_TIMEZONE = "UTC";

function dayKey(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return localDateKey(date, timeZone);
}

function everyDayInRange(
  periodStart: Date,
  asOfDate: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string[] {
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth(),
      periodStart.getUTCDate(),
    ),
  );
  const end = new Date(
    Date.UTC(
      asOfDate.getUTCFullYear(),
      asOfDate.getUTCMonth(),
      asOfDate.getUTCDate(),
    ),
  );
  while (cursor.getTime() <= end.getTime()) {
    days.push(dayKey(cursor, timeZone));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Buckets breach instants by calendar day (in the organization's timezone,
 * Phase 6.5 — defaults to UTC for a caller that doesn't pass one) across
 * [periodStart, asOfDate] inclusive, defaulting every day in range to 0 — a
 * quiet day is a real zero on the line chart, not a gap.
 */
export function bucketBreachesByDay(
  breachedAtDates: Date[],
  periodStart: Date,
  asOfDate: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): BreachesOverTimePoint[] {
  const counts = new Map<string, number>();
  for (const date of breachedAtDates) {
    const key = dayKey(date, timeZone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const points: BreachesOverTimePoint[] = [];
  const cursor = new Date(
    Date.UTC(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth(),
      periodStart.getUTCDate(),
    ),
  );
  const end = new Date(
    Date.UTC(
      asOfDate.getUTCFullYear(),
      asOfDate.getUTCMonth(),
      asOfDate.getUTCDate(),
    ),
  );
  while (cursor.getTime() <= end.getTime()) {
    const key = dayKey(cursor, timeZone);
    points.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

/**
 * The Breaches Over Time chart's Support/Engineering split (dashboard
 * reconstruction, Stitch `elapsed_dashboard`): same day-bucketing as
 * `bucketBreachesByDay`, but each breach is additionally attributed to
 * whichever leg owned the case at the instant it breached. Kept as its own
 * function rather than changing `bucketBreachesByDay`'s return shape, since
 * that shape is a tested contract for the plain breach-count chart.
 */
export function bucketBreachesByDayAndLeg(
  breaches: { breachedAt: Date; leg: Leg }[],
  periodStart: Date,
  asOfDate: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): BreachesOverTimeLegPoint[] {
  const supportCounts = new Map<string, number>();
  const engineeringCounts = new Map<string, number>();
  for (const { breachedAt, leg } of breaches) {
    const key = dayKey(breachedAt, timeZone);
    const bucket = leg === "engineering" ? engineeringCounts : supportCounts;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }

  return everyDayInRange(periodStart, asOfDate, timeZone).map((date) => ({
    date,
    supportCount: supportCounts.get(date) ?? 0,
    engineeringCount: engineeringCounts.get(date) ?? 0,
  }));
}

/**
 * The UTC instant of local 23:59:59.999 on `dateKey` ("YYYY-MM-DD") in
 * `timeZone` — an approximation (one offset lookup near local noon, no
 * DST-transition binary search) that's precise enough for a chart's 7-day
 * trailing window, unlike `computeDeadline`'s exact-to-the-minute SLA
 * arithmetic in packages/core, which this deliberately doesn't reuse.
 */
function endOfLocalDayUtc(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  if (timeZone === "UTC") return new Date(`${dateKey}T23:59:59.999Z`);
  const approxNoonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(approxNoonUtc)
      .map((part) => [part.type, part.value] as const),
  ) as Record<string, string>;
  const localReadingAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = localReadingAsUtc - approxNoonUtc;
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMs);
}

/**
 * The "SLA Compliance Trend" chart's time series (dashboard reconstruction):
 * for each day in range, the met-vs-breached rate among commitments closed
 * in the trailing 7 days ending that day, both bucketed by the
 * organization's timezone (Phase 6.5 — defaults to UTC for a caller that
 * doesn't pass one). A day with nothing closed in its trailing window is
 * `null` — a real gap, never interpolated or fabricated.
 */
export function computeComplianceTrend(
  closedRows: { status: CommitmentStatus; closedAt: Date }[],
  periodStart: Date,
  asOfDate: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): ComplianceTrendPoint[] {
  const TRAILING_WINDOW_DAYS = 7;
  return everyDayInRange(periodStart, asOfDate, timeZone).map((date) => {
    const dayEnd = endOfLocalDayUtc(date, timeZone);
    const windowStart = new Date(
      dayEnd.getTime() - TRAILING_WINDOW_DAYS * 86_400_000,
    );
    const windowRows = closedRows.filter(
      (row) => row.closedAt > windowStart && row.closedAt <= dayEnd,
    );
    const relevant = windowRows.filter(
      (r) => r.status === "met" || r.status === "breached",
    );
    if (relevant.length === 0) return { date, compliancePercent: null };
    const met = relevant.filter((r) => r.status === "met").length;
    return {
      date,
      compliancePercent: Math.round((met / relevant.length) * 1000) / 10,
    };
  });
}

export interface BreachOccurrence {
  commitmentId: string;
  caseId: string;
  kind: CommitmentKind;
  caseOpenedAt: Date;
  breachedAt: Date;
}

interface BreachedEvaluationRow {
  commitmentId: string;
  breachedAt: Date;
}

/**
 * The instant each commitment's SLA clock actually crossed its target, read
 * from history instead of recomputed live: the `breachedAt` (working-minutes/
 * calendar/pause-aware target-crossing instant, `evaluateCommitment`'s
 * `effectiveDueAt`) recorded on the earliest persisted `"breached"`
 * Evaluation row per commitment that has one. `runEvaluationPipeline`
 * (packages/commitments/src/evaluate-pipeline.ts) only ever appends
 * Evaluations — id from `stableHash`, written with `skipDuplicates` — and
 * never updates or deletes one, so this is immutable across re-evaluation
 * and reconciliation.
 *
 * Deliberately NOT `evaluatedAt`: that column is only when the row was
 * computed — a poll cycle, a reconciliation sweep, or a one-off historical
 * backfill — which can land arbitrarily far after the real breach instant
 * (e.g. every commitment imported from a customer's SLA backlog gets its
 * first Evaluation, and therefore the same `evaluatedAt`, on the day it was
 * imported, regardless of when each one actually breached weeks or months
 * earlier). Using `evaluatedAt` as a breach-instant proxy silently pulls
 * every such breach onto that one day.
 *
 * A commitment with no breached Evaluation yet, or whose breached Evaluation
 * predates this column (`breachedAt IS NULL` — see
 * packages/commitments/src/scripts/backfill-breached-at.ts for backfilling
 * those), has no entry; callers fall back to `dueAt`. Same `DISTINCT ON`
 * shape as `anomaly-data.ts`'s terminal-evaluation lookup.
 */
export async function getPersistedBreachedAt(
  prisma: PrismaClient,
  commitmentIds: string[],
): Promise<Map<string, Date>> {
  if (commitmentIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<BreachedEvaluationRow[]>(
    Prisma.sql`
      SELECT DISTINCT ON (e."commitmentId") e."commitmentId", e."breachedAt"
      FROM "evaluations" e
      WHERE e."commitmentId" IN (${Prisma.join(commitmentIds)})
        AND e.status = 'breached'
        AND e."breachedAt" IS NOT NULL
      ORDER BY e."commitmentId", e."evaluatedAt" ASC, e.id ASC
    `,
  );
  return new Map(rows.map((row) => [row.commitmentId, row.breachedAt]));
}

/**
 * The commitments that actually breached inside [periodStart, asOfDate].
 * `breachedAtByCommitmentId` (`getPersistedBreachedAt`) is the source of
 * truth; a candidate missing from it (no breached Evaluation persisted yet)
 * falls back to its `dueAt`. Pure and synchronous on purpose — no event
 * loading here, so a candidate whose breach instant falls outside the
 * period never costs more than a map lookup (performance-plan.md Phase 2
 * item 2: this replaces a live, calendar-aware `computeBreachedAt` re-run
 * over every candidate's full event history).
 */
export function findBreachesInPeriod(
  candidates: {
    commitmentId: string;
    caseId: string;
    kind: CommitmentKind;
    caseOpenedAt: Date;
    dueAt: Date;
  }[],
  breachedAtByCommitmentId: ReadonlyMap<string, Date>,
  periodStart: Date,
  asOfDate: Date,
): BreachOccurrence[] {
  const breaches: BreachOccurrence[] = [];
  for (const candidate of candidates) {
    const breachedAt =
      breachedAtByCommitmentId.get(candidate.commitmentId) ?? candidate.dueAt;
    if (breachedAt < periodStart || breachedAt > asOfDate) continue;

    breaches.push({
      commitmentId: candidate.commitmentId,
      caseId: candidate.caseId,
      kind: candidate.kind,
      caseOpenedAt: candidate.caseOpenedAt,
      breachedAt,
    });
  }
  return breaches.sort(
    (a, b) => a.breachedAt.getTime() - b.breachedAt.getTime(),
  );
}

/**
 * The dashboard's "breached this period" KPI tile and per-kind breakdown:
 * counts only, from `findBreachesInPeriod`, the same set the Breaches Over
 * Time chart buckets, so the two always agree. Neither of `DashboardView`'s
 * two consumers (the KPI tile's `.length`, the per-kind panel's `.reduce`)
 * ever renders an individual breach row, so this skips building
 * `BreachedCaseRow`s (and the case `externalId`/`subject`/`customerName`
 * that would only ever back them) entirely.
 */
export function summarizeBreachedThisPeriod(
  breaches: BreachOccurrence[],
): BreachedThisPeriodSummary {
  const byKind: Partial<Record<CommitmentKind, number>> = {};
  for (const breach of breaches) {
    byKind[breach.kind] = (byKind[breach.kind] ?? 0) + 1;
  }
  return { total: breaches.length, byKind };
}

type ComplianceBucket = "met" | "at_risk" | "breached";
const SEVERITY_RANK: Record<ComplianceBucket, number> = {
  met: 0,
  at_risk: 1,
  breached: 2,
};

function bucketOf(status: CommitmentStatus): ComplianceBucket | null {
  if (status === "breached") return "breached";
  if (status === "at_risk") return "at_risk";
  if (status === "on_track" || status === "met") return "met";
  return null; // cancelled — doesn't reflect an SLA outcome
}

/**
 * Worst-status-wins per case: a case with one breached and one on-track
 * commitment counts as breached, not split across two buckets. Cases whose
 * only commitments are cancelled are excluded from the total.
 */
export function summarizeCompliance(
  commitmentStatuses: { caseId: string; status: CommitmentStatus }[],
): SlaComplianceBreakdown {
  const worstByCaseId = new Map<string, ComplianceBucket>();
  for (const { caseId, status } of commitmentStatuses) {
    const bucket = bucketOf(status);
    if (bucket === null) continue;
    const existing = worstByCaseId.get(caseId);
    if (!existing || SEVERITY_RANK[bucket] > SEVERITY_RANK[existing]) {
      worstByCaseId.set(caseId, bucket);
    }
  }

  let metSla = 0;
  let atRisk = 0;
  let breached = 0;
  for (const bucket of worstByCaseId.values()) {
    if (bucket === "met") metSla++;
    else if (bucket === "at_risk") atRisk++;
    else breached++;
  }

  return { metSla, atRisk, breached, total: worstByCaseId.size };
}

/** A commitment whose persisted `status` is already `"breached"` (open or closed-in-period) — the candidate set `getProjectAnalytics` needs the true `breachedAt` instant for. See `dashboard-data.ts`'s `getDashboardData` for how these are cheaply identified from already-loaded, narrow-select commitment rows, with zero extra queries. */
export type BreachCandidateRow = CommitmentRecord & { caseOpenedAt: Date };

/**
 * Assembles the Project Analytics section (SLA Compliance, Breaches Over
 * Time, Breaches by Stage). `openCommitmentStatuses` and
 * `closedPeriodCommitmentStatuses` are passed in from `getDashboardData`,
 * which already fetches them for the KPI tiles — reusing them here avoids a
 * duplicate query. `breachCandidateRows` is also passed in (persisted
 * `status === "breached"` commitments only, open or closed-in-period) — this
 * set has no upper bound (an org accumulates breached-but-still-open
 * commitments over its lifetime), so `getPersistedBreachedAt` resolves all
 * of them in one indexed query and `findBreachesInPeriod` filters to the
 * period with no event loading. Only the candidates that actually land
 * inside the period (normally a small fraction of the full candidate set)
 * ever cost an event load, for the by-stage leg attribution below. The
 * breaches found are also returned as `breachedThisPeriod` rows, so the
 * dashboard's breach KPI and list reuse them instead of querying again.
 */
export async function getProjectAnalytics(
  prisma: PrismaClient,
  periodStart: Date,
  asOfDate: Date,
  openCommitmentStatuses: { caseId: string; status: CommitmentStatus }[],
  closedPeriodCommitmentStatuses: {
    caseId: string;
    status: CommitmentStatus;
    closedAt?: Date | null;
  }[],
  breachCandidateRows: BreachCandidateRow[],
  timeZone: string = DEFAULT_TIMEZONE,
): Promise<{
  analytics: ProjectAnalyticsData;
  breachedThisPeriod: BreachedThisPeriodSummary;
}> {
  const compliance = summarizeCompliance([
    ...openCommitmentStatuses,
    ...closedPeriodCommitmentStatuses,
  ]);

  const commitmentRows = breachCandidateRows;

  const breachedAtByCommitmentId = await getPersistedBreachedAt(
    prisma,
    commitmentRows.map((row) => row.id),
  );

  const breaches = findBreachesInPeriod(
    commitmentRows.map((row) => ({
      commitmentId: row.id,
      caseId: row.caseId,
      kind: row.kind,
      caseOpenedAt: row.caseOpenedAt,
      dueAt: row.dueAt,
    })),
    breachedAtByCommitmentId,
    periodStart,
    asOfDate,
  );

  const breachesOverTime = bucketBreachesByDay(
    breaches.map((b) => b.breachedAt),
    periodStart,
    asOfDate,
    timeZone,
  );

  // Events only for the cases that actually breached in-period — never the
  // full candidate set (performance-plan.md Phase 2 item 2's narrow-select
  // ground rule).
  const breachCaseIds = [...new Set(breaches.map((b) => b.caseId))];
  const eventRows =
    breachCaseIds.length > 0
      ? await prisma.normalizedEvent.findMany({
          where: { caseId: { in: breachCaseIds } },
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
          },
        })
      : [];
  const eventsByCaseId = new Map<string, NormalizedEvent[]>();
  for (const row of eventRows) {
    const domainEvent = toNormalizedEventDomain(row);
    const existing = eventsByCaseId.get(row.caseId);
    if (existing) existing.push(domainEvent);
    else eventsByCaseId.set(row.caseId, [domainEvent]);
  }

  const legCounts = new Map<Leg, number>();
  const breachLegs: { breachedAt: Date; leg: Leg }[] = [];
  for (const breach of breaches) {
    const { spans } = deriveLegSpans(eventsByCaseId.get(breach.caseId) ?? [], {
      caseOpenedAt: breach.caseOpenedAt.toISOString(),
    });
    perfCount("deriveLegSpans");
    const leg = legAtTime(spans, breach.breachedAt.toISOString());
    legCounts.set(leg, (legCounts.get(leg) ?? 0) + 1);
    breachLegs.push({ breachedAt: breach.breachedAt, leg });
  }

  const breachesByStage: BreachesByStageRow[] = [...legCounts.entries()]
    .map(([leg, count]) => ({ leg, count }))
    .sort((a, b) => b.count - a.count);

  const breachesOverTimeByLeg = bucketBreachesByDayAndLeg(
    breachLegs,
    periodStart,
    asOfDate,
    timeZone,
  );

  const complianceTrend = computeComplianceTrend(
    closedPeriodCommitmentStatuses.filter(
      (
        row,
      ): row is { caseId: string; status: CommitmentStatus; closedAt: Date } =>
        row.closedAt != null,
    ),
    periodStart,
    asOfDate,
    timeZone,
  );

  const breachedThisPeriod = summarizeBreachedThisPeriod(breaches);

  return {
    analytics: {
      compliance,
      breachesOverTime,
      breachesOverTimeByLeg,
      breachesByStage,
      complianceTrend,
    },
    breachedThisPeriod,
  };
}
