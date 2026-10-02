/**
 * Coverage for the Phase 2 item 2 rewrite (performance-plan.md) that
 * `dashboard-breaches.test.ts` doesn't already exercise: health-by-kind
 * reading persisted status instead of a live re-evaluation, the at-risk
 * table's bounded-candidate overflow count staying exact regardless of how
 * many commitments exist, Total Escalated / the Attribution Ledger being
 * scoped to closed-in-period cases only, and breach candidates being
 * identified from persisted `status` alone (an `at_risk` commitment past its
 * `dueAt` must never be treated as a breach).
 */
import type { PrismaClient } from "@sla/db";
import { describe, expect, it } from "vitest";
import { getDashboardData } from "../src/lib/dashboard-data";

const ORG = "org-1";
const asOf = new Date("2026-09-17T12:00:00.000Z");

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

interface EventRow {
  id: string;
  caseId: string;
  type: string;
  occurredAt: Date;
  actor: string;
  system: string;
  fromState: string | null;
  toState: string | null;
  sourceRawEventId: string;
}

interface CaseFixture {
  commitment: {
    id: string;
    caseId: string;
    kind: "first_response";
    policyVersionId: string;
    calendarVersionId: string;
    startedAt: Date;
    targetMinutes: number;
    dueAt: Date;
    status: "on_track" | "at_risk" | "breached" | "met" | "cancelled";
    closedAt: Date | null;
  };
  case: {
    id: string;
    externalId: string;
    subject: string;
    openedAt: Date;
    customer: { name: string } | null;
    priority: string | null;
    tier: string | null;
  };
  events: EventRow[];
}

let seq = 0;
/** A minimal open-or-closed case+commitment fixture; `events` defaults to just a `case_created`. */
function makeCase(opts: {
  status: CaseFixture["commitment"]["status"];
  dueAt: Date;
  startedAt?: Date;
  closedAt?: Date | null;
  events?: EventRow[];
  withPolicy?: boolean;
}): CaseFixture {
  const name = `f${seq++}`;
  const caseId = `case-${name}`;
  const startedAt = opts.startedAt ?? new Date(opts.dueAt.getTime() - 60 * 60_000);
  const events = opts.events ?? [
    {
      id: `${name}-created`,
      caseId,
      type: "case_created",
      occurredAt: startedAt,
      actor: "customer",
      system: "zendesk",
      fromState: null,
      toState: "open",
      sourceRawEventId: `${name}-raw`,
    },
  ];
  return {
    commitment: {
      id: `commitment-${name}`,
      caseId,
      kind: "first_response",
      policyVersionId: opts.withPolicy === false ? "missing" : policyRow.id,
      calendarVersionId: opts.withPolicy === false ? "missing" : calendarRow.id,
      startedAt,
      targetMinutes: 60,
      dueAt: opts.dueAt,
      status: opts.status,
      closedAt: opts.closedAt ?? null,
    },
    case: {
      id: caseId,
      externalId: `ZD-${name}`,
      subject: `Subject ${name}`,
      openedAt: startedAt,
      customer: { name: `Customer ${name}` },
      priority: null,
      tier: null,
    },
    events,
  };
}

function fakePrisma(fixtures: CaseFixture[]): PrismaClient {
  const commitments = fixtures.map((f) => ({ ...f.commitment, case: f.case }));
  const events = fixtures.flatMap((f) => f.events);
  const caseLinks: never[] = [];
  const inIds = (where: { id?: { in: string[] } } | undefined) => where?.id?.in ?? [];
  const openNonCancelled = () =>
    commitments
      .filter((c) => c.closedAt === null && c.status !== "cancelled")
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
        if (
          where.closedAt === null &&
          typeof where.status === "object" &&
          where.status !== null &&
          "not" in (where.status as Record<string, unknown>)
        ) {
          const rows = openNonCancelled();
          return typeof take === "number" ? rows.slice(0, take) : rows;
        }
        if (where.closedAt === null) {
          const rows = commitments.filter((c) => c.closedAt === null);
          return typeof where.status === "string"
            ? rows.filter((c) => c.status === where.status)
            : rows;
        }
        const range = where.closedAt as { gte?: Date; lt?: Date; lte?: Date; not?: null };
        if (range && "not" in range) return [];
        return commitments.filter(
          (c) =>
            c.closedAt !== null &&
            (!range.gte || c.closedAt >= range.gte) &&
            (!range.lt || c.closedAt < range.lt) &&
            (!range.lte || c.closedAt <= range.lte),
        );
      },
      groupBy: async ({}: { by: string[]; where: Record<string, unknown> }) => {
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
    evaluation: { findMany: async () => [] },
    // getCycleTimeAnomalies's terminal-evaluation lookup (Phase 2 item 3) —
    // these fixtures never carry enough closed commitments per (customer,
    // kind) to clear detectCycleTimeAnomaly's minimums regardless, so an
    // empty result here is enough to keep it a no-op.
    $queryRaw: async () => [],
    organization: { findUnique: async () => ({ timezone: "UTC" }) },
    case: { findMany: async () => [], count: async () => 0 },
    workerSettings: { findUnique: async () => null },
    integration: { findMany: async () => [] },
    notificationFailure: { findMany: async () => [], count: async () => 0 },
    sLAPolicyVersion: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        inIds(where).includes(policyRow.id) ? [policyRow] : [],
    },
    businessCalendarVersion: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        inIds(where).includes(calendarRow.id) ? [calendarRow] : [],
    },
    normalizedEvent: {
      findMany: async ({ where }: { where: { caseId: { in: string[] } } }) =>
        events.filter((e) => where.caseId.in.includes(e.caseId)),
    },
    caseLink: { findMany: async () => caseLinks },
  } as unknown as PrismaClient;
}

describe("getDashboardData health by kind", () => {
  it("reports the persisted status, not a live re-evaluation", async () => {
    // dueAt already passed with no events since — a live evaluation would
    // call this breached, but the worker hasn't caught up yet, so the
    // persisted status (still on_track) is what health-by-kind must show.
    const stale = makeCase({
      status: "on_track",
      dueAt: new Date("2026-09-17T10:00:00.000Z"),
    });

    const data = await getDashboardData(fakePrisma([stale]), ORG, asOf);

    const firstResponse = data.healthByKind.find((h) => h.kind === "first_response");
    expect(firstResponse).toEqual({ kind: "first_response", onTrack: 1, atRisk: 0, breached: 0 });
    // The at-risk table itself is still live — it's only health-by-kind that
    // must stay decoupled from that live evaluation.
    expect(data.atRisk[0]?.status).toBe("breached");
  });
});

describe("getDashboardData at-risk overflow", () => {
  it("counts the true total via a cheap count, not the evaluated candidate page", async () => {
    // More than the ~60-row candidate page dashboard-data.ts evaluates.
    const cases = Array.from({ length: 70 }, (_, i) =>
      makeCase({
        status: "on_track",
        dueAt: new Date(asOf.getTime() + (i + 1) * 60_000),
      }),
    );

    const data = await getDashboardData(fakePrisma(cases), ORG, asOf);

    expect(data.atRisk).toHaveLength(12);
    expect(data.atRiskOverflowCount).toBe(70 - 12);
    // Nearest-dueAt-first ordering survived the bounded candidate page.
    expect(data.atRisk[0]?.externalId).toBe(cases[0]!.case.externalId);
  });

  it("never treats a cancelled commitment as an at-risk candidate", async () => {
    const cancelled = makeCase({
      status: "cancelled",
      dueAt: new Date(asOf.getTime() + 60_000),
    });

    const data = await getDashboardData(fakePrisma([cancelled]), ORG, asOf);

    expect(data.atRisk).toHaveLength(0);
    expect(data.atRiskOverflowCount).toBe(0);
  });
});

describe("getDashboardData Total Escalated / Attribution Ledger", () => {
  const engineeringEvents = (caseId: string, openedAt: Date): EventRow[] => [
    {
      id: `${caseId}-created`,
      caseId,
      type: "case_created",
      occurredAt: openedAt,
      actor: "customer",
      system: "zendesk",
      fromState: null,
      toState: "open",
      sourceRawEventId: `${caseId}-raw-1`,
    },
    {
      id: `${caseId}-linked`,
      caseId,
      type: "issue_linked",
      occurredAt: new Date(openedAt.getTime() + 30 * 60_000),
      actor: "agent",
      system: "jira",
      fromState: null,
      toState: null,
      sourceRawEventId: `${caseId}-raw-2`,
    },
  ];

  it("excludes a currently-open case even if its leg history touches engineering", async () => {
    const openedAt = new Date("2026-09-10T00:00:00.000Z");
    const stillOpen = makeCase({
      status: "at_risk",
      dueAt: new Date(asOf.getTime() + 60_000),
      startedAt: openedAt,
    });
    stillOpen.events = engineeringEvents(stillOpen.case.id, openedAt);

    const data = await getDashboardData(fakePrisma([stillOpen]), ORG, asOf);

    expect(data.totalEscalated.count).toBe(0);
    expect(data.attributionLedger.engineeringLegHours).toBe(0);
  });

  it("includes a case closed within the period with the same leg history", async () => {
    const openedAt = new Date("2026-09-10T00:00:00.000Z");
    const closedInPeriod = makeCase({
      status: "met",
      dueAt: new Date(openedAt.getTime() + 60 * 60_000),
      startedAt: openedAt,
      closedAt: new Date("2026-09-11T00:00:00.000Z"),
    });
    closedInPeriod.events = engineeringEvents(closedInPeriod.case.id, openedAt);

    const data = await getDashboardData(fakePrisma([closedInPeriod]), ORG, asOf);

    expect(data.totalEscalated.count).toBe(1);
    expect(data.attributionLedger.engineeringLegHours).toBeGreaterThan(0);
  });
});

describe("getDashboardData breach candidates", () => {
  it("never counts an at_risk (not breached) commitment as a breach, even past its dueAt", async () => {
    const pastDueButAtRisk = makeCase({
      status: "at_risk",
      dueAt: new Date("2026-09-16T00:00:00.000Z"),
    });

    const data = await getDashboardData(fakePrisma([pastDueButAtRisk]), ORG, asOf);

    expect(data.breachedThisPeriod).toEqual({ total: 0, byKind: {} });
  });
});

describe("getDashboardData integration health: stale with no error (N3.8 Blind Spots)", () => {
  const row = (provider: string, status: string, lastSuccessfulSyncAt: Date | null) => ({
    provider,
    status,
    lastSyncAt: asOf,
    lastSyncError: null,
    lastSuccessfulSyncAt,
    failingSince: null,
  });

  it("marks an integration stale from the worker's cadence even though nothing failed", async () => {
    const prisma = fakePrisma([]);
    // Operator-set cadence: 30 s poll, grace factor 3 → stale after 90 s.
    (prisma as unknown as { workerSettings: unknown }).workerSettings = {
      findUnique: async () => ({
        activePollIntervalMs: 30_000,
        reconciliationIntervalMs: 30 * 60_000,
        freshnessGraceFactor: 3,
      }),
    };
    (prisma as unknown as { integration: unknown }).integration = {
      findMany: async () => [
        row("zendesk", "connected", new Date(asOf.getTime() - 30_000)), // fresh: inside 30 s × 3
        row("jira", "connected", new Date(asOf.getTime() - 10 * 60_000)), // stale, no error
        row("linear", "connected", null), // never synced
        row("github", "disconnected", null), // not expected to sync
      ],
    };

    const { integrationHealth } = await getDashboardData(prisma, ORG, asOf);
    const byProvider = Object.fromEntries(integrationHealth.map((r) => [r.provider, r]));

    expect(byProvider.zendesk).toMatchObject({ stale: false, staleSince: null, lastSyncError: null });
    expect(byProvider.jira).toMatchObject({
      stale: true,
      staleSince: new Date(asOf.getTime() - 10 * 60_000 + 90_000).toISOString(),
      lastSyncError: null,
    });
    expect(byProvider.linear).toMatchObject({ stale: true, staleSince: null });
    expect(byProvider.github).toMatchObject({ stale: false });
  });
});
