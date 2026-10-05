/**
 * performance-plan.md Phase 2 item 4: the /at-risk page is now server-
 * paginated — it live-evaluates only the current page (`skip`/`take`),
 * never the whole open set, and every "org-wide" figure (header counts,
 * KPI tiles, severity chip counts) comes from persisted-field counts/narrow
 * selects instead. This suite uses an in-memory fake Prisma (this repo's
 * usual convention — see case-list-data.test.ts) and the real
 * `evaluateCommitment`/`deriveLegSpans` to exercise `getAtRiskData`'s query
 * building, pagination and row-mapping, trusting Prisma/Postgres itself to
 * execute `where`/`orderBy` correctly.
 */
import type { PrismaClient } from "@sla/db";
import { describe, expect, it } from "vitest";

// `server-only` throws unless bundled for React Server Components.
import { vi } from "vitest";
vi.mock("server-only", () => ({}));

const { getAtRiskData, parseAtRiskParams, IMMEDIATE_THREAT_MINUTES, ELEVATED_RISK_MINUTES } =
  await import("../src/lib/at-risk-data");

const ORG = "org-1";
const AS_OF = new Date("2026-09-20T12:00:00.000Z");

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
  targets: [{ kind: "resolution", minutes: 240 }],
  pauseOnStates: [],
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

interface CommitmentFixture {
  id: string;
  caseId: string;
  kind: "resolution";
  cycleKey: string;
  policyVersionId: string;
  calendarVersionId: string;
  startedAt: Date;
  targetMinutes: number;
  dueAt: Date;
  status: "on_track" | "at_risk" | "breached" | "met" | "cancelled";
  closedAt: Date | null;
  case: {
    id: string;
    externalId: string;
    subject: string;
    organizationId: string;
    deletedAt: Date | null;
    openedAt: Date;
    requesterName: string | null;
    priority: string | null;
    tier: string | null;
    assigneeName: string | null;
    customer: { name: string; tier: string | null } | null;
    caseLinks: { unlinkedAt: null; system: string; externalId: string; confidence: string }[];
  };
}

let seq = 0;
function makeCommitment(opts: {
  status: CommitmentFixture["status"];
  dueAt: Date;
  startedAt?: Date;
  priority?: string | null;
  subject?: string;
  events?: EventRow[];
}): { commitment: CommitmentFixture; events: EventRow[] } {
  const name = `f${seq++}`;
  const caseId = `case-${name}`;
  const startedAt = opts.startedAt ?? new Date(opts.dueAt.getTime() - 4 * 60 * 60_000);
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
      kind: "resolution",
      cycleKey: "single",
      policyVersionId: policyRow.id,
      calendarVersionId: calendarRow.id,
      startedAt,
      targetMinutes: 240,
      dueAt: opts.dueAt,
      status: opts.status,
      closedAt: null,
      case: {
        id: caseId,
        externalId: `ZD-${name}`,
        subject: opts.subject ?? `Subject ${name}`,
        organizationId: ORG,
        deletedAt: null,
        openedAt: startedAt,
        requesterName: `Requester ${name}`,
        priority: opts.priority ?? null,
        tier: null,
        assigneeName: null,
        customer: { name: `Customer ${name}`, tier: null },
        caseLinks: [],
      },
    },
    events,
  };
}

function fakePrisma(
  fixtures: { commitment: CommitmentFixture; events: EventRow[] }[],
): PrismaClient {
  const commitments = fixtures.map((f) => f.commitment);
  const events = fixtures.flatMap((f) => f.events);

  const openCandidates = (where: any) => {
    let rows = commitments.filter(
      (c) =>
        c.case.organizationId === ORG &&
        c.case.deletedAt === null &&
        c.closedAt === null &&
        ["on_track", "at_risk", "breached"].includes(c.status),
    );

    const caseWhere = where?.case;
    if (caseWhere?.priority?.in) {
      rows = rows.filter((c) => caseWhere.priority.in.includes(c.case.priority));
    }
    if (caseWhere?.OR) {
      const q = (caseWhere.OR[0].subject.contains as string).toLowerCase();
      rows = rows.filter((c) =>
        [c.case.subject, c.case.externalId, c.case.requesterName, c.case.customer?.name]
          .filter((v): v is string => v != null)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (caseWhere?.caseLinks?.some) {
      rows = rows.filter((c) => c.case.caseLinks.length > 0);
    }
    if (where?.status === "breached") {
      rows = rows.filter((c) => c.status === "breached");
    }
    if (where?.dueAt?.lt) {
      rows = rows.filter((c) => c.dueAt.getTime() < where.dueAt.lt.getTime());
    }
    if (where?.dueAt?.gte) {
      rows = rows.filter((c) => c.dueAt.getTime() >= where.dueAt.gte.getTime());
    }

    return rows.sort(
      (a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id),
    );
  };

  return {
    commitment: {
      findMany: async (args: any) => {
        const rows = openCandidates(args.where);
        const skip = args.skip ?? 0;
        const take = args.take ?? rows.length;
        return rows.slice(skip, skip + take);
      },
      count: async (args: any) => openCandidates(args.where).length,
    },
    sLAPolicyVersion: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes(policyRow.id) ? [policyRow] : [],
    },
    businessCalendarVersion: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes(calendarRow.id) ? [calendarRow] : [],
    },
    normalizedEvent: {
      findMany: async ({ where }: { where: { caseId: { in: string[] } } }) =>
        events.filter((e) => where.caseId.in.includes(e.caseId)),
    },
    caseLink: {
      findMany: async ({ where }: { where: { caseId: { in: string[] } } }) =>
        commitments
          .filter((c) => where.caseId.in.includes(c.caseId))
          .flatMap((c) => c.case.caseLinks.map((l) => ({ ...l, caseId: c.caseId }))),
    },
  } as unknown as PrismaClient;
}

describe("getAtRiskData pagination", () => {
  it("paginates: rowCount/pageCount reflect the full match, rows only the current page, live-evaluated", async () => {
    const fixtures = Array.from({ length: 5 }, (_, i) =>
      makeCommitment({
        status: "on_track",
        dueAt: new Date(AS_OF.getTime() + (i + 1) * 60 * 60_000),
      }),
    );

    const data = await getAtRiskData(
      fakePrisma(fixtures),
      ORG,
      { page: 1, pageSize: 2 },
      AS_OF,
    );

    expect(data.rowCount).toBe(5);
    expect(data.pageCount).toBe(3);
    expect(data.rows).toHaveLength(2);
    // Ordered by dueAt asc, id tiebreaker — never re-sorted by live remainingMinutes.
    expect(data.rows[0]!.externalId).toBe(fixtures[0]!.commitment.case.externalId);
    expect(data.rows[1]!.externalId).toBe(fixtures[1]!.commitment.case.externalId);
  });

  it("carries the clock state and deadline the case page counts down to, not just business minutes", async () => {
    const [fixture] = [
      makeCommitment({
        status: "on_track",
        dueAt: new Date(AS_OF.getTime() + 60 * 60_000),
      }),
    ];

    const data = await getAtRiskData(fakePrisma([fixture!]), ORG, {}, AS_OF);

    const row = data.rows[0]!;
    expect(row.clockState).toBe("running");
    expect(row.remainingSeconds).toBe(Math.round(row.remainingMinutes * 60));
    // Always-open calendar: the deadline is exactly the remaining business time away.
    expect(new Date(row.effectiveDueAt!).getTime()).toBe(AS_OF.getTime() + row.remainingSeconds * 1000);
  });

  it("page 2 returns the next slice in the same order", async () => {
    const fixtures = Array.from({ length: 5 }, (_, i) =>
      makeCommitment({
        status: "on_track",
        dueAt: new Date(AS_OF.getTime() + (i + 1) * 60 * 60_000),
      }),
    );

    const data = await getAtRiskData(
      fakePrisma(fixtures),
      ORG,
      { page: 2, pageSize: 2 },
      AS_OF,
    );

    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]!.externalId).toBe(fixtures[2]!.commitment.case.externalId);
    expect(data.rows[1]!.externalId).toBe(fixtures[3]!.commitment.case.externalId);
  });

  it("never treats a cancelled or met commitment as a candidate", async () => {
    const cancelled = makeCommitment({
      status: "cancelled",
      dueAt: new Date(AS_OF.getTime() + 60_000),
    });
    const met = makeCommitment({
      status: "met",
      dueAt: new Date(AS_OF.getTime() + 60_000),
    });

    const data = await getAtRiskData(fakePrisma([cancelled, met]), ORG, {}, AS_OF);

    expect(data.rows).toHaveLength(0);
    expect(data.rowCount).toBe(0);
    expect(data.totalCount).toBe(0);
  });

  it("filters the paginated page by severity, scoped to persisted Case.priority", async () => {
    const p1 = makeCommitment({
      status: "at_risk",
      dueAt: new Date(AS_OF.getTime() + 60 * 60_000),
      priority: "urgent",
    });
    const p2 = makeCommitment({
      status: "at_risk",
      dueAt: new Date(AS_OF.getTime() + 60 * 60_000),
      priority: "high",
    });

    const data = await getAtRiskData(
      fakePrisma([p1, p2]),
      ORG,
      { severity: "P1" },
      AS_OF,
    );

    expect(data.rows.map((r) => r.externalId)).toEqual([p1.commitment.case.externalId]);
    expect(data.rowCount).toBe(1);
    // But the severity chip counts stay org-wide, independent of the active filter.
    expect(data.counts.severity.all).toBe(2);
    expect(data.counts.severity.P1).toBe(1);
    expect(data.counts.severity.P2).toBe(1);
  });

  it("searches subject/externalId/requesterName/customer name", async () => {
    const match = makeCommitment({
      status: "at_risk",
      dueAt: new Date(AS_OF.getTime() + 60 * 60_000),
      subject: "Payments failing for Acme",
    });
    const other = makeCommitment({
      status: "at_risk",
      dueAt: new Date(AS_OF.getTime() + 60 * 60_000),
      subject: "Unrelated ticket",
    });

    const data = await getAtRiskData(fakePrisma([match, other]), ORG, { q: "Acme" }, AS_OF);

    expect(data.rows.map((r) => r.externalId)).toEqual([match.commitment.case.externalId]);
  });
});

describe("getAtRiskData org-wide counts", () => {
  it("breachedCount and totalCount are independent of the current page and filters", async () => {
    const breached = makeCommitment({
      status: "breached",
      dueAt: new Date(AS_OF.getTime() - 60 * 60_000),
      priority: "urgent",
    });
    const onTrack = makeCommitment({
      status: "on_track",
      dueAt: new Date(AS_OF.getTime() + 10 * 60 * 60_000),
      priority: "low",
    });

    const data = await getAtRiskData(
      fakePrisma([breached, onTrack]),
      ORG,
      { page: 1, pageSize: 1, severity: "P4" },
      AS_OF,
    );

    expect(data.totalCount).toBe(2);
    expect(data.breachedCount).toBe(1);
    // The paginated set is scoped to the P4 filter (only onTrack matches).
    expect(data.rowCount).toBe(1);
  });

  it("immediateThreat/elevatedRisk counts approximate live remainingMinutes from persisted dueAt, org-wide", async () => {
    const imminent = makeCommitment({
      status: "at_risk",
      dueAt: new Date(AS_OF.getTime() + 30 * 60_000), // 30 min < 60 min threshold
    });
    const elevated = makeCommitment({
      status: "at_risk",
      dueAt: new Date(AS_OF.getTime() + 100 * 60_000), // between 60 and 150
    });
    const safe = makeCommitment({
      status: "on_track",
      dueAt: new Date(AS_OF.getTime() + 500 * 60_000),
    });

    const data = await getAtRiskData(
      fakePrisma([imminent, elevated, safe]),
      ORG,
      { page: 1, pageSize: 1 }, // page is tiny — counts must still be org-wide
      AS_OF,
    );

    expect(data.immediateThreatCount).toBe(1);
    expect(data.immediateThreatSample.map((s) => s.externalId)).toEqual([
      imminent.commitment.case.externalId,
    ]);
    expect(data.elevatedRiskCount).toBe(1);
    expect(data.elevatedRiskSample.map((s) => s.externalId)).toEqual([
      elevated.commitment.case.externalId,
    ]);
    expect(IMMEDIATE_THREAT_MINUTES).toBe(60);
    expect(ELEVATED_RISK_MINUTES).toBe(150);
  });

  it("linkedCertainCount is org-wide, from persisted CaseLink rows only", async () => {
    const linked = makeCommitment({
      status: "at_risk",
      dueAt: new Date(AS_OF.getTime() + 60 * 60_000),
    });
    linked.commitment.case.caseLinks = [
      { unlinkedAt: null, system: "jira", externalId: "ENG-1", confidence: "certain" },
    ];
    const unlinked = makeCommitment({
      status: "at_risk",
      dueAt: new Date(AS_OF.getTime() + 60 * 60_000),
    });

    const data = await getAtRiskData(fakePrisma([linked, unlinked]), ORG, {}, AS_OF);

    expect(data.linkedCertainCount).toBe(1);
  });
});

describe("parseAtRiskParams", () => {
  it("defaults page/pageSize/filters when nothing is provided", () => {
    expect(parseAtRiskParams({})).toEqual({
      page: 1,
      pageSize: 50,
      severity: "all",
      q: "",
    });
  });

  it("clamps pageSize to the allow-list", () => {
    expect(parseAtRiskParams({ pageSize: "999" }).pageSize).toBe(50);
    expect(parseAtRiskParams({ pageSize: "25" }).pageSize).toBe(25);
    expect(parseAtRiskParams({ pageSize: "100" }).pageSize).toBe(100);
  });

  it("takes the first value when a param is repeated in the URL", () => {
    expect(parseAtRiskParams({ severity: ["P1", "P2"] }).severity).toBe("P1");
  });
});
