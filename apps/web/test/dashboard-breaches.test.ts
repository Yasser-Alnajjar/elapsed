/**
 * The dashboard's breach KPI and "breached this period" list must count the
 * same breaches the Breaches Over Time chart plots: placed by when the SLA
 * clock crossed the target (`computeBreachedAt`), not by the worker's
 * `Evaluation.evaluatedAt`. A reconciliation run that stamps every
 * historical breach "now" must not pull older breaches into the period.
 */
import type { PrismaClient } from "@sla/db";
import { describe, expect, it } from "vitest";
import { toBreachedCaseRows } from "../src/lib/analytics-data";
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
 * Just enough Prisma for getDashboardData: the where clauses it builds are
 * matched on their distinguishing shape. Evaluations all claim "breached at
 * reconciliation time" — if anything still read them, the old breach would
 * leak into the period.
 */
function fakePrisma(cases: Seeded[]): PrismaClient {
  const commitments = cases.map((c) => c.commitment);
  const events = cases.flatMap((c) => c.events);
  const inIds = (where: { id?: { in: string[] } } | undefined) => where?.id?.in ?? [];
  return {
    commitment: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.OR) {
          // getProjectAnalytics' breach candidates.
          return commitments.filter(
            (c) =>
              c.startedAt <= asOf &&
              (c.closedAt === null || (c.status === "breached" && c.closedAt >= periodStart)),
          );
        }
        if (where.closedAt === null) return commitments.filter((c) => c.closedAt === null);
        const range = where.closedAt as { gte?: Date; lt?: Date; lte?: Date; not?: null };
        if (range && "not" in range) return [];
        return commitments
          .filter(
            (c) =>
              c.closedAt !== null &&
              (!range.gte || c.closedAt >= range.gte) &&
              (!range.lt || c.closedAt < range.lt) &&
              (!range.lte || c.closedAt <= range.lte),
          )
          .map((c) => ({ caseId: c.caseId, status: c.status }));
      },
    },
    evaluation: {
      findMany: async () =>
        commitments.map((c) => ({ commitmentId: c.id, status: "breached", evaluatedAt: reconciledAt })),
    },
    organization: { findUnique: async () => ({ engineeringLegTargetMinutes: null, timezone: "UTC" }) },
    case: {
      // Phase 6.2's "no matching policy" panel: every case in this fixture
      // has a commitment, so nothing qualifies.
      findMany: async () => [],
    },
    integration: {
      // Phase 6.3: no integrations connected in this fixture.
      findMany: async () => [],
    },
    notificationFailure: {
      // Phase 6.4: no failed deliveries in this fixture.
      findMany: async () => [],
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

    expect(data.breachedThisPeriod).toEqual([
      {
        commitmentId: "commitment-in-closed",
        caseId: "case-in-closed",
        externalId: "ZD-in-closed",
        customerName: "Customer in-closed",
        kind: "first_response",
        subject: "Subject in-closed",
      },
      {
        commitmentId: "commitment-in-open",
        caseId: "case-in-open",
        externalId: "ZD-in-open",
        customerName: "Customer in-open",
        kind: "first_response",
        subject: "Subject in-open",
      },
    ]);
  });

  it("makes the breach KPI equal the Breaches Over Time chart total", async () => {
    const data = await getDashboardData(fakePrisma(cases), ORG, asOf);

    const chartTotal = data.analytics.breachesOverTime.reduce((sum, p) => sum + p.count, 0);
    expect(chartTotal).toBe(2);
    expect(data.breachedThisPeriod.length).toBe(chartTotal);
    expect(data.analytics.breachesOverTime.filter((p) => p.count > 0)).toEqual([
      { date: "2026-09-09", count: 1 },
      { date: "2026-09-13", count: 1 },
    ]);
    const stageTotal = data.analytics.breachesByStage.reduce((sum, r) => sum + r.count, 0);
    expect(stageTotal).toBe(chartTotal);
  });

  it("shows nothing when the only breach predates the period", async () => {
    const data = await getDashboardData(fakePrisma([beforePeriod, met]), ORG, asOf);

    expect(data.breachedThisPeriod).toEqual([]);
    expect(data.analytics.breachesOverTime.every((p) => p.count === 0)).toBe(true);
  });
});

describe("toBreachedCaseRows", () => {
  const breach = (caseId: string) => ({
    commitmentId: `commitment-${caseId}`,
    caseId,
    kind: "resolution" as const,
    caseOpenedAt: new Date("2026-09-01T00:00:00.000Z"),
    breachedAt: new Date("2026-09-02T00:00:00.000Z"),
  });

  it("keeps one row per breached commitment, in breach order", () => {
    const rows = toBreachedCaseRows(
      [breach("c1"), { ...breach("c1"), commitmentId: "second", kind: "first_response" }],
      new Map([["c1", { externalId: "ZD-1", subject: null, customerName: null }]]),
    );
    expect(rows.map((r) => r.kind)).toEqual(["resolution", "first_response"]);
  });

  it("drops a breach whose case details aren't loaded", () => {
    expect(toBreachedCaseRows([breach("missing")], new Map())).toEqual([]);
  });

  it("carries a next_reply breach through with the correct display label", () => {
    const rows = toBreachedCaseRows(
      [{ ...breach("c1"), kind: "next_reply" }],
      new Map([["c1", { externalId: "ZD-1", subject: null, customerName: null }]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("next_reply");
    expect(formatCommitmentKind(rows[0]!.kind)).toBe("Next reply");
  });
});
