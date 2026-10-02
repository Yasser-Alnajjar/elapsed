import type { PrismaClient } from "@sla/db";
import {
  localDateKey,
  type CommitmentKind,
  type CommitmentStatus,
  type Leg,
} from "@sla/core";
import {
  attributeBreachLegs,
  findBreachesInPeriod,
  getPersistedBreachedAt,
  summarizeCompliance,
  type BreachOccurrence,
  type CommitmentRecord,
} from "@sla/commitments";
import type {
  BreachedThisPeriodSummary,
  BreachesByStageRow,
  BreachesOverTimeLegPoint,
  BreachesOverTimePoint,
  ComplianceTrendPoint,
  ProjectAnalyticsData,
} from "./types/dashboard";

// The breach and compliance arithmetic lives in `@sla/commitments` so the monthly
// report uses the same code; re-exported here for the callers that import it from this file.
export { findBreachesInPeriod, getPersistedBreachedAt, summarizeCompliance };
export type { BreachOccurrence };

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
  // ground rule). The attribution itself is shared with the monthly report.
  const legCounts = new Map<Leg, number>();
  const breachLegs: { breachedAt: Date; leg: Leg }[] = [];
  for (const { breach, leg } of await attributeBreachLegs(prisma, breaches)) {
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
