/**
 * The dashboard's breach KPI and "breached this period" list must count the
 * same breaches the Breaches Over Time chart plots: placed by `breachedAt`
 * (the earliest persisted `"breached"` Evaluation per commitment, falling
 * back to `dueAt` — `getPersistedBreachedAt` in analytics-data.ts), not by
 * a later reconciliation sweep's `Evaluation.evaluatedAt` pulling older
 * breaches into the period. `getDashboardData` identifies breach
 * *candidates* cheaply from persisted `Commitment.status === "breached"`
 * (a bounded, `status`-filtered query, not the whole open set), then
 * resolves each candidate's `breachedAt` with one indexed query instead of
 * a live `computeBreachedAt` re-run. This fixture's `$queryRaw` returns no
 * Evaluation rows, so every candidate here falls back to `dueAt` — which,
 * for an always-open calendar with no pauses and no reply before the
 * deadline, is the same instant `computeBreachedAt` would have found, so
 * the expected breach dates below are unchanged. See performance-plan.md
 * Phase 2 item 2.
 */
import type { PrismaClient } from "@sla/db";
import { describe, expect, it } from "vitest";
import { summarizeBreachedThisPeriod } from "../src/lib/analytics-data";
import { getDashboardData } from "../src/lib/dashboard-data";
import { formatCommitmentKind } from "../src/lib/format";

const ORG = "org-1";
const asOf = new Date("2026-09-17T12:00:00.000Z");
// Trailing 30 days, as dashboard-data.ts computes it.
const periodStart = new Date("2026-08-18T12:00:00.000Z");
// The run that first evaluated every imported commitment, inside the period.
const reconciledAt = new Date("2026-09-16T23:14:25.556Z");

const calendarRow = {
  id: "cal",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};
const policyRow = {
  id: "pv",
  policyId: "p",
  version: 1,
  match: {},
  targets: [{ kind: "first_response", minutes: 60 }],
  pauseOnStates: ["pending_customer"],
  calendarVersionId: "cal",
  warnAtPercent: [50, 80, 95],
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
};

/** A case opened at `openedAt` with a 60-minute first-response commitment, closed by the customer-facing close at `closedAt` if given. */
function seedCase(name: string, openedAt: string, closedAt?: string) {
  const caseId = `case-${name}`;
  const startedAt = new Date(openedAt);
  const breached = !closedAt || new Date(closedAt).getTime() - startedAt.getTime() > 60 * 60_000;
  const commitment = {
    id: `commitment-${name}`,
    caseId,
    kind: "first_response" as const,
    policyVersionId: policyRow.id,
    calendarVersionId: calendarRow.id,
    startedAt,
    targetMinutes: 60,
    dueAt: new Date(startedAt.getTime() + 60 * 60_000),
    status: breached ? ("breached" as const) : ("met" as const),
    // Where the worker stamped it, not when the case really closed.
    closedAt: closedAt ? reconciledAt : null,
    createdAt: reconciledAt,
    case: {
      id: caseId,
      organizationId: ORG,
      deletedAt: null,
      externalId: `ZD-${name}`,
      subject: `Subject ${name}`,
      openedAt: startedAt,
      customer: { name: `Customer ${name}` },
    },
  };
  const events: {
    id: string;
    caseId: string;
    type: string;
    occurredAt: Date;
    actor: string;
    system: string;
    fromState: string | null;
    toState: string | null;
    sourceRawEventId: string;
  }[] = [
    {
      id: `${name}-created`,
      caseId,
      type: "case_created",
      occurredAt: startedAt,
      actor: "customer",
      system: "zendesk",
      fromState: null,
      toState: "open",
      sourceRawEventId: `${name}-raw-1`,
    },
  ];
  if (closedAt) {
    events.push({
      id: `${name}-closed`,
      caseId,
      type: "case_closed",
      occurredAt: new Date(closedAt),
      actor: "agent",
      system: "zendesk",
      fromState: "open",
      toState: "resolved",
      sourceRawEventId: `${name}-raw-2`,
    });
  }
  return { commitment, events };
}

type Seeded = ReturnType<typeof seedCase>;

/**
 * Just enough Prisma for getDashboardData: the where/orderBy/take shapes it
 * builds are matched on their distinguishing shape. `getCycleTimeAnomalies`'s
 * candidate query (Phase 2 item 3) shares its `closedAt: { gte, lte }` shape
 * with the period-bound queries below, so this fixture's commitments do flow
 * into it — but its terminal-evaluation lookup is a raw `$queryRaw`, mocked
 * to return nothing, so `getCycleTimeAnomalies` always finds zero samples
 * regardless. `getPersistedBreachedAt`'s own `$queryRaw` (analytics-data.ts)
 * is distinguished by its query text containing `"breachedAt"`; by default it
 * also returns nothing, so every candidate here falls back to `dueAt` (see
 * the file's top comment). Pass `breachedAtByCommitmentId` to instead have it
 * return real persisted rows, for tests that need `breachedAt` to diverge
 * from `dueAt`/`evaluatedAt`.
 */
function fakePrisma(cases: Seeded[], breachedAtByCommitmentId: ReadonlyMap<string, Date> = new Map()): PrismaClient {
  const commitments = cases.map((c) => c.commitment);
  const events = cases.flatMap((c) => c.events);
  const inIds = (where: { id?: { in: string[] } } | undefined) => where?.id?.in ?? [];
  // This fixture's commitments are always "breached" or "met" (never
  // "cancelled"), but the check mirrors production's `status: { not:
  // "cancelled" }` filter, so it's kept generic rather than assuming that.
  const openNonCancelled = () =>
    commitments
      .filter((c) => c.closedAt === null && (c.status as string) !== "cancelled")
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id));
  return {
    commitment: {
      findMany: async ({
        where,
        take,
      }: {
        where: Record<string, unknown>;
        take?: number;
      }) => {
        // At-risk candidates: `closedAt: null` + `status: { not: "cancelled" }`,
        // dueAt-ordered, bounded by `take`.
        if (
          where.closedAt === null &&
          typeof where.status === "object" &&
          where.status !== null &&
          "not" in (where.status as Record<string, unknown>)
        ) {
          const rows = openNonCancelled();
          return typeof take === "number" ? rows.slice(0, take) : rows;
        }
        // Open commitments: health-by-kind and compliance's open half read
        // every one (no status filter); the breach candidates' open half
        // filters to `status: "breached"` in the query itself.
        if (where.closedAt === null) {
          const rows = commitments.filter((c) => c.closedAt === null);
          return typeof where.status === "string"
            ? rows.filter((c) => c.status === where.status)
            : rows;
        }
        const range = where.closedAt as { gte?: Date; lt?: Date; lte?: Date };
        return commitments.filter(
          (c) =>
            c.closedAt !== null &&
            (!range.gte || c.closedAt >= range.gte) &&
            (!range.lt || c.closedAt < range.lt) &&
            (!range.lte || c.closedAt <= range.lte),
        );
      },
      groupBy: async () => {
        const buckets = new Map<string, { kind: string; status: string; count: number }>();
        for (const row of commitments.filter((c) => c.closedAt === null)) {
          const key = `${row.kind}:${row.status}`;
          const existing = buckets.get(key);
          if (existing) existing.count += 1;
          else buckets.set(key, { kind: row.kind, status: row.status, count: 1 });
        }
        return [...buckets.values()].map((b) => ({
          kind: b.kind,
          status: b.status,
          _count: { _all: b.count },
        }));
      },
      count: async ({ where }: { where: Record<string, unknown> }) => {
        if (
          where.closedAt === null &&
          typeof where.status === "object" &&
          where.status !== null &&
          "not" in (where.status as Record<string, unknown>)
        ) {
          return openNonCancelled().length;
        }
        return 0;
      },
    },
    evaluation: {
      findMany: async () =>
        commitments.map((c) => ({ commitmentId: c.id, status: "breached", evaluatedAt: reconciledAt })),
    },
    // getCycleTimeAnomalies's terminal-evaluation lookup (Phase 2 item 3) and
    // getPersistedBreachedAt's (analytics-data.ts) share this one mock — see
    // the fixture's doc comment above.
    $queryRaw: async (query: { text: string; values: unknown[] }) => {
      if (!query.text.includes('"breachedAt"')) return [];
      return (query.values as string[])
        .filter((commitmentId) => breachedAtByCommitmentId.has(commitmentId))
        .map((commitmentId) => ({
          commitmentId,
          breachedAt: breachedAtByCommitmentId.get(commitmentId)!,
        }));
    },
    organization: { findUnique: async () => ({ timezone: "UTC" }) },
    case: {
      // Phase 6.2's "no matching policy" panel: every case in this fixture
      // has a commitment, so nothing qualifies.
      findMany: async () => [],
      count: async () => 0,
      // N5.5's link coverage panel: no cases in the window, so nothing to group.
      groupBy: async () => [],
    },
    workerSettings: { findUnique: async () => null },
    integration: {
      // Phase 6.3: no integrations connected in this fixture.
      findMany: async () => [],
    },
    notificationFailure: {
      // Phase 6.4: no failed deliveries in this fixture.
      findMany: async () => [],
      count: async () => 0,
    },
    sLAPolicyVersion: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => (inIds(where).includes(policyRow.id) ? [policyRow] : []) },
    businessCalendarVersion: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => (inIds(where).includes(calendarRow.id) ? [calendarRow] : []),
    },
    normalizedEvent: {
      findMany: async ({ where }: { where: { caseId: { in: string[] } } }) =>
        events.filter((e) => where.caseId.in.includes(e.caseId)),
    },
    caseLink: {
      // Dashboard reconstruction (Total Escalated / Attribution Ledger):
      // no case-link fixtures in these tests, so every case is unlinked.
      findMany: async () => [],
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;
}

describe("getDashboardData breaches this period", () => {
  const inPeriodClosed = seedCase("in-closed", "2026-09-09T22:44:30.000Z", "2026-09-15T23:21:00.000Z");
  const inPeriodOpen = seedCase("in-open", "2026-09-13T10:00:00.000Z");
  // Breached 2026-08-10, closed 2026-09-10 — reconciled inside the period, but the breach isn't.
  const beforePeriod = seedCase("before", "2026-08-10T09:00:00.000Z", "2026-09-10T00:00:00.000Z");
  const met = seedCase("met", "2026-09-10T08:00:00.000Z", "2026-09-10T08:45:00.000Z");
  const cases = [inPeriodClosed, inPeriodOpen, beforePeriod, met];

  it("counts only breaches whose SLA clock crossed the target inside the period", async () => {
    const data = await getDashboardData(fakePrisma(cases), ORG, asOf);

    expect(data.breachedThisPeriod).toEqual({
      total: 2,
      byKind: { first_response: 2 },
    });
  });

  it("makes the breach KPI equal the Breaches Over Time chart total", async () => {
    const data = await getDashboardData(fakePrisma(cases), ORG, asOf);

    const chartTotal = data.analytics.breachesOverTime.reduce((sum, p) => sum + p.count, 0);
    expect(chartTotal).toBe(2);
    expect(data.breachedThisPeriod.total).toBe(chartTotal);
    expect(data.analytics.breachesOverTime.filter((p) => p.count > 0)).toEqual([
      { date: "2026-09-09", count: 1 },
      { date: "2026-09-13", count: 1 },
    ]);
    const stageTotal = data.analytics.breachesByStage.reduce((sum, r) => sum + r.count, 0);
    expect(stageTotal).toBe(chartTotal);
  });

  it("shows nothing when the only breach predates the period", async () => {
    const data = await getDashboardData(fakePrisma([beforePeriod, met]), ORG, asOf);

    expect(data.breachedThisPeriod).toEqual({ total: 0, byKind: {} });
    expect(data.analytics.breachesOverTime.every((p) => p.count === 0)).toBe(true);
  });

  it("spreads a historical-import batch's breaches across their real days, not the reconciliation day (regression)", async () => {
    // Reproduces the production bug directly: several cases opened and
    // breached on different days, all first evaluated in one batch (e.g. a
    // backlog import) — `evaluatedAt` is identical for all of them, but
    // `breachedAt` (persisted per evaluate-pipeline.ts's `toEvaluationCreateInput`)
    // is each commitment's real, distinct SLA-clock-crossing instant.
    const importAsOf = new Date("2026-09-28T12:00:00.000Z");
    const c29 = seedCase("c29", "2026-09-21T21:38:16.000Z", "2026-09-25T00:00:00.000Z");
    const c32 = seedCase("c32", "2026-09-22T07:11:22.000Z", "2026-09-25T00:00:00.000Z");
    const c45 = seedCase("c45", "2026-09-23T14:34:37.000Z", "2026-09-25T00:00:00.000Z");
    const breachedAtByCommitmentId = new Map([
      [c29.commitment.id, new Date("2026-09-21T22:38:16.000Z")],
      [c32.commitment.id, new Date("2026-09-22T08:11:22.000Z")],
      [c45.commitment.id, new Date("2026-09-23T15:34:37.000Z")],
    ]);

    const data = await getDashboardData(
      fakePrisma([c29, c32, c45], breachedAtByCommitmentId),
      ORG,
      importAsOf,
    );

    const nonZero = data.analytics.breachesOverTime.filter((p) => p.count > 0);
    expect(nonZero).toEqual([
      { date: "2026-09-21", count: 1 },
      { date: "2026-09-22", count: 1 },
      { date: "2026-09-23", count: 1 },
    ]);
    expect(nonZero.find((p) => p.date === "2026-09-28")).toBeUndefined();
    expect(data.breachedThisPeriod.total).toBe(3);
  });
});

describe("summarizeBreachedThisPeriod", () => {
  const breach = (caseId: string) => ({
    commitmentId: `commitment-${caseId}`,
    caseId,
    kind: "resolution" as const,
    caseOpenedAt: new Date("2026-09-01T00:00:00.000Z"),
    breachedAt: new Date("2026-09-02T00:00:00.000Z"),
  });

  it("counts one per breach, split by kind", () => {
    const summary = summarizeBreachedThisPeriod([
      breach("c1"),
      { ...breach("c1"), commitmentId: "second", kind: "first_response" },
    ]);
    expect(summary).toEqual({
      total: 2,
      byKind: { resolution: 1, first_response: 1 },
    });
  });

  // Case-vs-commitment semantics: this counts breached *commitments*, not
  // deduplicated cases. Two breaches on the same case ("c1" above) count as
  // 2, matching one row per Commitment in `breachCandidateRows` — the same
  // set `bucketBreachesByDay`/`bucketBreachesByDayAndLeg` chart. The KPI
  // tile is labelled "Breached Cases", which is accurate today only because
  // no case in current data has more than one breached commitment
  // (verified against production data as part of this investigation); the
  // label and this commitment-level count would diverge the moment a case
  // breaches on two kinds (e.g. both First Response and Resolution). That's
  // a pre-existing naming/semantics question, not something this fix
  // changes — changing it would also have to change the chart and the
  // by-stage/by-leg breakdowns to keep them all in agreement (see
  // `getProjectAnalytics`'s doc comment), which is out of scope here.
  it("does not deduplicate two breached commitments on the same case (documents current commitment-level semantics)", () => {
    const summary = summarizeBreachedThisPeriod([
      breach("case-x"),
      { ...breach("case-x"), commitmentId: "case-x-resolution", kind: "resolution" },
      { ...breach("case-x"), commitmentId: "case-x-first-response", kind: "first_response" },
    ]);
    expect(summary.total).toBe(3);
  });

  it("returns zero counts for no breaches", () => {
    expect(summarizeBreachedThisPeriod([])).toEqual({ total: 0, byKind: {} });
  });

  it("carries a next_reply breach through with the correct display label", () => {
    const summary = summarizeBreachedThisPeriod([{ ...breach("c1"), kind: "next_reply" }]);
    expect(summary.byKind.next_reply).toBe(1);
    expect(formatCommitmentKind("next_reply")).toBe("Next reply");
  });
});
