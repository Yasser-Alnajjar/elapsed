/**
 * performance-plan.md Phase 2 item 1: the case list is now server-paginated
 * and snapshot-only (no event loads, no `evaluateCommitment`). This suite
 * uses an in-memory fake Prisma (this repo's usual convention — see
 * case-detail-next-reply.test.ts) rather than a real database: it exercises
 * `getCaseListData`'s own query-building and row-mapping logic, trusting
 * Prisma/Postgres itself to execute `where`/`orderBy` correctly.
 */
import type { PrismaClient } from "@sla/db";
import { describe, expect, it, vi } from "vitest";

// `server-only` throws unless bundled for React Server Components.
vi.mock("server-only", () => ({}));

const {
  getCaseListData,
  parseCaseListParams,
} = await import("../src/lib/case-list-data");

const ORG = "org-1";
const AS_OF = new Date("2026-09-20T12:00:00.000Z");

interface FakeCommitment {
  id: string;
  kind: string;
  status: string;
  targetMinutes: number;
  startedAt: Date;
  dueAt: Date;
  closedAt: Date | null;
}

interface FakeCaseLink {
  unlinkedAt: Date | null;
  system: "jira" | "linear" | "github";
  externalId: string;
  confidence: "certain" | "probable";
  evidence: unknown;
}

interface FakeCase {
  id: string;
  organizationId: string;
  deletedAt: Date | null;
  externalId: string;
  subject: string | null;
  requesterName: string | null;
  priority: string | null;
  tier: string | null;
  channel: string | null;
  assigneeName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  customer: { name: string } | null;
  commitments: FakeCommitment[];
  caseLinks: FakeCaseLink[];
}

interface FakeEvaluation {
  commitmentId: string;
  evaluatedAt: Date;
  elapsedSeconds: number;
}

function caseA(): FakeCase {
  return {
    id: "case-a",
    organizationId: ORG,
    deletedAt: null,
    externalId: "A-1",
    subject: "Payments failing",
    requesterName: "Alice",
    priority: "urgent", // P1
    tier: null,
    channel: "web",
    assigneeName: "Agent Smith",
    openedAt: new Date("2026-09-19T00:00:00.000Z"),
    closedAt: null,
    customer: { name: "Acme" },
    commitments: [
      {
        id: "commit-a1",
        kind: "first_response",
        status: "on_track",
        targetMinutes: 60,
        startedAt: new Date("2026-09-20T11:00:00.000Z"), // 60 min before AS_OF
        dueAt: new Date("2026-09-20T13:00:00.000Z"), // 60 min after AS_OF
        closedAt: null,
      },
    ],
    caseLinks: [],
  };
}

function caseB(): FakeCase {
  return {
    id: "case-b",
    organizationId: ORG,
    deletedAt: null,
    externalId: "B-1",
    subject: "Checkout 500s",
    requesterName: "Bob",
    priority: "high", // P2
    tier: null,
    channel: "web",
    assigneeName: null,
    openedAt: new Date("2026-09-18T00:00:00.000Z"),
    closedAt: new Date("2026-09-19T00:00:00.000Z"),
    customer: { name: "Globex" },
    commitments: [
      {
        id: "commit-b1",
        kind: "resolution",
        status: "breached",
        targetMinutes: 480,
        startedAt: new Date("2026-09-18T00:00:00.000Z"),
        dueAt: new Date("2026-09-18T08:00:00.000Z"),
        closedAt: new Date("2026-09-19T00:00:00.000Z"),
      },
    ],
    caseLinks: [
      {
        unlinkedAt: null,
        system: "jira",
        externalId: "ENG-42",
        confidence: "certain",
        evidence: { statusName: "In Progress" },
      },
    ],
  };
}

function caseC_unmatched(): FakeCase {
  return {
    id: "case-c",
    organizationId: ORG,
    deletedAt: null,
    externalId: "C-1",
    subject: "General question",
    requesterName: "Carol",
    priority: null,
    tier: null,
    channel: "email",
    assigneeName: null,
    openedAt: new Date("2026-09-17T00:00:00.000Z"),
    closedAt: null,
    customer: null,
    commitments: [],
    caseLinks: [],
  };
}

function caseD_settledNoEvaluation(): FakeCase {
  return {
    id: "case-d",
    organizationId: ORG,
    deletedAt: null,
    externalId: "D-1",
    subject: "Feature request",
    requesterName: "Dave",
    priority: "normal", // P3
    tier: null,
    channel: "web",
    assigneeName: "Agent Smith",
    openedAt: new Date("2026-09-16T00:00:00.000Z"),
    closedAt: new Date("2026-09-17T00:00:00.000Z"),
    customer: { name: "Initech" },
    commitments: [
      {
        id: "commit-d1",
        kind: "resolution",
        status: "met",
        targetMinutes: 480,
        startedAt: new Date("2026-09-16T00:00:00.000Z"),
        dueAt: new Date("2026-09-16T08:00:00.000Z"),
        closedAt: new Date("2026-09-17T00:00:00.000Z"),
      },
    ],
    caseLinks: [],
  };
}

const EVALUATIONS: FakeEvaluation[] = [
  {
    commitmentId: "commit-b1",
    evaluatedAt: new Date("2026-09-19T00:00:00.000Z"),
    elapsedSeconds: 500,
  },
  // An older evaluation for the same commitment — must not win over the one above.
  {
    commitmentId: "commit-b1",
    evaluatedAt: new Date("2026-09-18T12:00:00.000Z"),
    elapsedSeconds: 999,
  },
];

/** Matches this file's `Prisma.CaseWhereInput` subset — not a general-purpose Prisma engine. */
function matchesWhere(row: FakeCase, where: any): boolean {
  if (where.organizationId !== undefined && row.organizationId !== where.organizationId) return false;
  if ("deletedAt" in where && row.deletedAt !== where.deletedAt) return false;

  if ("closedAt" in where) {
    if (where.closedAt === null && row.closedAt !== null) return false;
    if (where.closedAt?.not === null && row.closedAt === null) return false;
  }

  if (where.priority?.in && !where.priority.in.includes(row.priority)) return false;

  if (where.commitments?.some) {
    const cond = where.commitments.some;
    const matches = row.commitments.some(
      (c) =>
        (cond.status === undefined || c.status === cond.status) &&
        (!("closedAt" in cond) || c.closedAt === cond.closedAt),
    );
    if (!matches) return false;
  }

  if (where.caseLinks?.some) {
    const cond = where.caseLinks.some;
    const matches = row.caseLinks.some(
      (l) =>
        l.unlinkedAt === cond.unlinkedAt &&
        cond.system.in.includes(l.system) &&
        (cond.confidence === undefined || l.confidence === cond.confidence),
    );
    if (!matches) return false;
  }
  if (where.caseLinks?.none) {
    const cond = where.caseLinks.none;
    const matches = row.caseLinks.some(
      (l) => l.unlinkedAt === cond.unlinkedAt && cond.system.in.includes(l.system),
    );
    if (matches) return false;
  }

  if (where.OR) {
    const q: string = where.OR[0].subject.contains.toLowerCase();
    const haystack = [row.subject, row.externalId, row.requesterName, row.customer?.name]
      .filter((v): v is string => v != null)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

function fakePrisma(cases: FakeCase[], evaluations: FakeEvaluation[]): PrismaClient {
  return {
    case: {
      findMany: async (args: any) => {
        const filtered = cases.filter((c) => matchesWhere(c, args.where));
        const orderBy: { [k: string]: string }[] = args.orderBy ?? [];
        const sorted = [...filtered].sort((a, b) => {
          for (const clause of orderBy) {
            const [field, dir] = Object.entries(clause)[0]!;
            const av = (a as any)[field];
            const bv = (b as any)[field];
            let cmp = 0;
            if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
            else if (av < bv) cmp = -1;
            else if (av > bv) cmp = 1;
            if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
          }
          return 0;
        });
        const skip = args.skip ?? 0;
        const take = args.take ?? sorted.length;
        const page = sorted.slice(skip, skip + take);
        return page.map((row) => ({
          ...row,
          caseLinks: row.caseLinks
            .filter(
              (l) =>
                l.unlinkedAt === args.include.caseLinks.where.unlinkedAt &&
                args.include.caseLinks.where.system.in.includes(l.system),
            )
            .slice(0, args.include.caseLinks.take),
        }));
      },
      count: async (args: any) => cases.filter((c) => matchesWhere(c, args.where)).length,
      groupBy: async (args: any) => {
        const base = cases.filter((c) => matchesWhere(c, args.where));
        const counts = new Map<string | null, number>();
        for (const row of base) {
          counts.set(row.priority, (counts.get(row.priority) ?? 0) + 1);
        }
        return [...counts.entries()].map(([priority, count]) => ({
          priority,
          _count: count,
        }));
      },
    },
    evaluation: {
      findMany: async (args: any) => {
        const ids: string[] = args.where.commitmentId.in;
        return evaluations
          .filter((e) => ids.includes(e.commitmentId))
          .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
      },
    },
  } as unknown as PrismaClient;
}

const ALL_CASES = () => [caseA(), caseB(), caseC_unmatched(), caseD_settledNoEvaluation()];

describe("getCaseListData", () => {
  it("paginates: rowCount/pageCount reflect the full match, cases only the current page", async () => {
    const data = await getCaseListData(
      fakePrisma(ALL_CASES(), EVALUATIONS),
      ORG,
      { page: 1, pageSize: 2 },
      AS_OF,
    );
    expect(data.rowCount).toBe(4);
    expect(data.pageCount).toBe(2);
    expect(data.cases).toHaveLength(2);
    // Default order: openedAt desc, id tiebreaker — case A is newest.
    expect(data.cases[0]!.caseId).toBe("case-a");
    expect(data.cases[1]!.caseId).toBe("case-b");
  });

  it("filters by status (approximated as 'has a commitment at this status')", async () => {
    const data = await getCaseListData(
      fakePrisma(ALL_CASES(), EVALUATIONS),
      ORG,
      { status: "breached" },
      AS_OF,
    );
    expect(data.cases.map((c) => c.caseId)).toEqual(["case-b"]);
  });

  it("filters by openState", async () => {
    const data = await getCaseListData(
      fakePrisma(ALL_CASES(), EVALUATIONS),
      ORG,
      { openState: "closed" },
      AS_OF,
    );
    expect(data.cases.map((c) => c.caseId).sort()).toEqual(["case-b", "case-d"]);
  });

  it("filters by linkState", async () => {
    const data = await getCaseListData(
      fakePrisma(ALL_CASES(), EVALUATIONS),
      ORG,
      { linkState: "linked" },
      AS_OF,
    );
    expect(data.cases.map((c) => c.caseId)).toEqual(["case-b"]);
  });

  it("filters by severity", async () => {
    const data = await getCaseListData(
      fakePrisma(ALL_CASES(), EVALUATIONS),
      ORG,
      { severity: "P1" },
      AS_OF,
    );
    expect(data.cases.map((c) => c.caseId)).toEqual(["case-a"]);
  });

  it("searches subject/externalId/requesterName/customer name", async () => {
    const data = await getCaseListData(
      fakePrisma(ALL_CASES(), EVALUATIONS),
      ORG,
      { q: "Alice" },
      AS_OF,
    );
    expect(data.cases.map((c) => c.caseId)).toEqual(["case-a"]);
  });

  it("derives liveCommitment from persisted dueAt/startedAt, never events", async () => {
    const data = await getCaseListData(
      fakePrisma([caseA()], []),
      ORG,
      {},
      AS_OF,
    );
    const row = data.cases[0]!;
    expect(row.liveCommitment).toEqual({
      kind: "first_response",
      status: "on_track",
      targetMinutes: 60,
      remainingMinutes: 60, // dueAt is 60 min after AS_OF
      elapsedSeconds: 3600, // startedAt is 60 min before AS_OF
    });
    expect(row.settledCommitment).toBeNull();
    expect(row.liveCommitment).not.toHaveProperty("supportLegMinutes");
    expect(row.liveCommitment).not.toHaveProperty("engineeringLegMinutes");
  });

  it("settledCommitment.elapsedSeconds comes from the latest persisted Evaluation, not a live run", async () => {
    const data = await getCaseListData(
      fakePrisma([caseB()], EVALUATIONS),
      ORG,
      {},
      AS_OF,
    );
    const row = data.cases[0]!;
    expect(row.liveCommitment).toBeNull();
    expect(row.settledCommitment).toEqual({
      kind: "resolution",
      status: "breached",
      targetMinutes: 480,
      elapsedSeconds: 500, // the newer of the two Evaluation rows, not 999
    });
  });

  it("settledCommitment.elapsedSeconds is null when no Evaluation has been recorded yet", async () => {
    const data = await getCaseListData(
      fakePrisma([caseD_settledNoEvaluation()], []),
      ORG,
      {},
      AS_OF,
    );
    expect(data.cases[0]!.settledCommitment!.elapsedSeconds).toBeNull();
  });

  it("a case with no commitments has no live or settled snapshot", async () => {
    const data = await getCaseListData(
      fakePrisma([caseC_unmatched()], []),
      ORG,
      {},
      AS_OF,
    );
    const row = data.cases[0]!;
    expect(row.liveCommitment).toBeNull();
    expect(row.settledCommitment).toBeNull();
    expect(row.worstCommitmentStatus).toBeNull();
  });

  it("filter-chip counts are org-wide, independent of pagination and other active filters", async () => {
    const data = await getCaseListData(
      fakePrisma(ALL_CASES(), EVALUATIONS),
      ORG,
      { page: 1, pageSize: 1, status: "breached" },
      AS_OF,
    );
    expect(data.counts.status.all).toBe(4);
    expect(data.counts.status.breached).toBe(1);
    expect(data.counts.open.open).toBe(2); // A, C
    expect(data.counts.open.closed).toBe(2); // B, D
    expect(data.counts.link.linked).toBe(1); // B
    expect(data.counts.linkedCertain).toBe(1); // B
    expect(data.counts.runningClock).toBe(1); // only A has an open commitment
    expect(data.counts.severity.P1).toBe(1);
    expect(data.counts.severity.P2).toBe(1);
    expect(data.counts.severity.P3).toBe(1);
  });

  it("fetches every matching row unbounded when pageSize is undefined (CSV export path)", async () => {
    const data = await getCaseListData(
      fakePrisma(ALL_CASES(), EVALUATIONS),
      ORG,
      { pageSize: undefined },
      AS_OF,
    );
    expect(data.cases).toHaveLength(4);
  });
});

describe("parseCaseListParams", () => {
  it("defaults page/pageSize/filters when nothing is provided", () => {
    expect(parseCaseListParams({})).toEqual({
      page: 1,
      pageSize: 25,
      sort: null,
      status: "all",
      openState: "all",
      linkState: "all",
      severity: "all",
      q: "",
    });
  });

  it("clamps pageSize to the allow-list", () => {
    expect(parseCaseListParams({ pageSize: "999" }).pageSize).toBe(25);
    expect(parseCaseListParams({ pageSize: "50" }).pageSize).toBe(50);
  });

  it("ignores an unknown sort id", () => {
    expect(parseCaseListParams({ sort: "notAColumn" }).sort).toBeNull();
  });

  it("parses a known sort id and direction", () => {
    expect(parseCaseListParams({ sort: "subject", dir: "asc" }).sort).toEqual({
      id: "subject",
      desc: false,
    });
    // Missing/other `dir` defaults to desc.
    expect(parseCaseListParams({ sort: "subject" }).sort).toEqual({
      id: "subject",
      desc: true,
    });
  });

  it("takes the first value when a param is repeated in the URL", () => {
    expect(parseCaseListParams({ status: ["breached", "met"] }).status).toBe(
      "breached",
    );
  });
});
