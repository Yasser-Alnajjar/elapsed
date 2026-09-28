import { describe, expect, it } from "vitest";
import {
  bucketBreachesByDay,
  bucketBreachesByDayAndLeg,
  findBreachesInPeriod,
  summarizeCompliance,
} from "../src/lib/analytics-data";

describe("bucketBreachesByDay", () => {
  it("fills every day in range with 0 when there are no breaches", () => {
    const points = bucketBreachesByDay(
      [],
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-09-03T12:00:00.000Z"),
    );
    expect(points).toEqual([
      { date: "2026-09-01", count: 0 },
      { date: "2026-09-02", count: 0 },
      { date: "2026-09-03", count: 0 },
    ]);
  });

  it("groups multiple breaches on the same UTC day", () => {
    const points = bucketBreachesByDay(
      [
        new Date("2026-09-02T01:00:00.000Z"),
        new Date("2026-09-02T23:00:00.000Z"),
        new Date("2026-09-03T00:00:00.000Z"),
      ],
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-09-03T00:00:00.000Z"),
    );
    expect(points).toEqual([
      { date: "2026-09-01", count: 0 },
      { date: "2026-09-02", count: 2 },
      { date: "2026-09-03", count: 1 },
    ]);
  });
});

describe("summarizeCompliance", () => {
  it("counts a healthy case (on_track) as met SLA", () => {
    const result = summarizeCompliance([{ caseId: "c1", status: "on_track" }]);
    expect(result).toEqual({ metSla: 1, atRisk: 0, breached: 0, total: 1 });
  });

  it("picks the worst status across a case's commitments", () => {
    const result = summarizeCompliance([
      { caseId: "c1", status: "met" },
      { caseId: "c1", status: "breached" },
      { caseId: "c2", status: "on_track" },
      { caseId: "c2", status: "at_risk" },
    ]);
    expect(result).toEqual({ metSla: 0, atRisk: 1, breached: 1, total: 2 });
  });

  it("excludes cases whose only commitments are cancelled", () => {
    const result = summarizeCompliance([{ caseId: "c1", status: "cancelled" }]);
    expect(result).toEqual({ metSla: 0, atRisk: 0, breached: 0, total: 0 });
  });

  it("ignores a cancelled commitment on a case that also has a real status", () => {
    const result = summarizeCompliance([
      { caseId: "c1", status: "cancelled" },
      { caseId: "c1", status: "met" },
    ]);
    expect(result).toEqual({ metSla: 1, atRisk: 0, breached: 0, total: 1 });
  });
});

// getPersistedBreachedAt (the DB-backed half — real `DISTINCT ON` semantics
// against actual Evaluation rows, including the "immutable across a later
// re-evaluation" guarantee) lives in breached-at-data.test.ts (real
// Postgres), the same split anomaly-data.ts's terminal-evaluation lookup
// uses between its DB query and its pure statistics.
describe("findBreachesInPeriod + bucketBreachesByDay (Breaches Over Time)", () => {
  const periodStart = new Date("2026-09-08T00:00:00.000Z");
  const asOf = new Date("2026-09-16T23:14:25.556Z");

  /** A breach candidate: `breachedAt` (persisted) wins over `dueAt` (fallback) when both are given. */
  function candidate(
    name: string,
    dueAt: string,
    opts: { breachedAt?: string; kind?: "first_response" | "resolution"; caseOpenedAt?: string } = {},
  ) {
    return {
      commitmentId: `commitment-${name}`,
      caseId: `case-${name}`,
      kind: opts.kind ?? ("first_response" as const),
      caseOpenedAt: new Date(opts.caseOpenedAt ?? dueAt),
      dueAt: new Date(dueAt),
      breachedAt: opts.breachedAt,
    };
  }

  function chartFor(
    candidates: ReturnType<typeof candidate>[],
    asOfDate: Date,
    from = periodStart,
  ) {
    const breachedAtByCommitmentId = new Map(
      candidates
        .filter((c) => c.breachedAt != null)
        .map((c) => [c.commitmentId, new Date(c.breachedAt!)]),
    );
    const breaches = findBreachesInPeriod(candidates, breachedAtByCommitmentId, from, asOfDate);
    const points = bucketBreachesByDay(breaches.map((b) => b.breachedAt), from, asOfDate);
    return { breaches, nonZero: points.filter((p) => p.count > 0) };
  }

  it("uses the persisted breachedAt when one is recorded", () => {
    const { breaches, nonZero } = chartFor(
      [candidate("22", "2026-09-09T23:44:30.000Z", { breachedAt: "2026-09-09T23:44:30.000Z" })],
      asOf,
    );
    expect(breaches.map((b) => b.breachedAt.toISOString())).toEqual(["2026-09-09T23:44:30.000Z"]);
    expect(nonZero).toEqual([{ date: "2026-09-09", count: 1 }]);
  });

  it("falls back to dueAt when no breached Evaluation is persisted yet", () => {
    const { breaches, nonZero } = chartFor([candidate("no-eval", "2026-09-11T10:00:00.000Z")], asOf);
    expect(breaches.map((b) => b.breachedAt.toISOString())).toEqual(["2026-09-11T10:00:00.000Z"]);
    expect(nonZero).toEqual([{ date: "2026-09-11", count: 1 }]);
  });

  it("aggregates several breaches on the same date and sorts by breachedAt", () => {
    const { breaches, nonZero } = chartFor(
      [
        candidate("b", "2026-09-11T12:00:00.000Z"),
        candidate("a", "2026-09-11T01:00:00.000Z"),
        candidate("c", "2026-09-11T22:37:58.000Z"),
      ],
      asOf,
    );
    expect(breaches.map((b) => b.commitmentId)).toEqual([
      "commitment-a",
      "commitment-b",
      "commitment-c",
    ]);
    expect(nonZero).toEqual([{ date: "2026-09-11", count: 3 }]);
  });

  it("buckets a breach just before midnight on that day, and one just after on the next", () => {
    const { nonZero } = chartFor(
      [candidate("before", "2026-09-13T23:59:30.000Z"), candidate("after", "2026-09-14T00:00:30.000Z")],
      asOf,
    );
    expect(nonZero).toEqual([
      { date: "2026-09-13", count: 1 },
      { date: "2026-09-14", count: 1 },
    ]);
  });

  it("leaves out a candidate whose breachedAt falls before the period", () => {
    const { breaches } = chartFor([candidate("old", "2026-09-07T00:58:42.000Z")], asOf);
    expect(breaches).toEqual([]);
  });

  it("leaves out a candidate whose breachedAt falls after asOfDate", () => {
    const { breaches } = chartFor(
      [candidate("future", "2026-09-20T00:00:00.000Z")],
      new Date("2026-09-16T00:00:00.000Z"),
    );
    expect(breaches).toEqual([]);
  });

  it("doesn't move a candidate's breachedAt when the chart is rerun later (immutability at this layer)", () => {
    const candidates = [candidate("22", "2026-09-09T22:44:30.000Z", { breachedAt: "2026-09-09T23:44:30.000Z" })];
    const first = chartFor(candidates, asOf);
    const rerun = chartFor(candidates, new Date("2026-09-20T06:00:00.000Z"));
    expect(rerun.breaches.map((b) => b.breachedAt.toISOString())).toEqual(
      first.breaches.map((b) => b.breachedAt.toISOString()),
    );
  });

  it("spreads breaches across their own days, not onto asOfDate, when breachedAt predates a same-day evaluation batch", () => {
    // Regression for the dashboard bug: several commitments evaluated for
    // the first time in the same batch (e.g. a historical-backlog import)
    // must not all land on the batch's day just because that's when the
    // Evaluation row recording each breach was written.
    const importDay = new Date("2026-09-28T10:38:14.539Z");
    const candidates = [
      candidate("29", "2026-09-21T22:38:16.000Z", { breachedAt: "2026-09-21T22:38:16.000Z" }),
      candidate("32", "2026-09-22T08:11:22.000Z", { breachedAt: "2026-09-22T08:11:22.000Z" }),
      candidate("45", "2026-09-23T15:34:37.000Z", { breachedAt: "2026-09-23T15:34:37.000Z" }),
      candidate("49", "2026-09-26T18:10:57.000Z", { breachedAt: "2026-09-26T18:10:57.000Z" }),
    ];
    const { nonZero } = chartFor(candidates, importDay, new Date("2026-09-21T00:00:00.000Z"));
    expect(nonZero).toEqual([
      { date: "2026-09-21", count: 1 },
      { date: "2026-09-22", count: 1 },
      { date: "2026-09-23", count: 1 },
      { date: "2026-09-26", count: 1 },
    ]);
    expect(nonZero.find((p) => p.date === "2026-09-28")).toBeUndefined();
  });
});

describe("bucketBreachesByDayAndLeg (Breaches Over Time, Support vs Engineering)", () => {
  const periodStart = new Date("2026-09-01T00:00:00.000Z");
  const asOf = new Date("2026-09-05T00:00:00.000Z");

  it("fills every day in range with zero counts when there are no breaches", () => {
    const points = bucketBreachesByDayAndLeg([], periodStart, asOf);
    expect(points).toEqual([
      { date: "2026-09-01", supportCount: 0, engineeringCount: 0 },
      { date: "2026-09-02", supportCount: 0, engineeringCount: 0 },
      { date: "2026-09-03", supportCount: 0, engineeringCount: 0 },
      { date: "2026-09-04", supportCount: 0, engineeringCount: 0 },
      { date: "2026-09-05", supportCount: 0, engineeringCount: 0 },
    ]);
  });

  it("attributes each breach to the leg owning the case at its own breachedAt, on its own day", () => {
    const points = bucketBreachesByDayAndLeg(
      [
        { breachedAt: new Date("2026-09-02T10:00:00.000Z"), leg: "support" },
        { breachedAt: new Date("2026-09-02T14:00:00.000Z"), leg: "engineering" },
        { breachedAt: new Date("2026-09-03T09:00:00.000Z"), leg: "engineering" },
      ],
      periodStart,
      asOf,
    );
    expect(points.filter((p) => p.supportCount > 0 || p.engineeringCount > 0)).toEqual([
      { date: "2026-09-02", supportCount: 1, engineeringCount: 1 },
      { date: "2026-09-03", supportCount: 0, engineeringCount: 1 },
    ]);
  });

  it("folds waiting_customer and unknown legs into supportCount, distinct only from engineering", () => {
    const points = bucketBreachesByDayAndLeg(
      [
        { breachedAt: new Date("2026-09-02T10:00:00.000Z"), leg: "waiting_customer" },
        { breachedAt: new Date("2026-09-02T11:00:00.000Z"), leg: "unknown" },
      ],
      periodStart,
      asOf,
    );
    expect(points.find((p) => p.date === "2026-09-02")).toEqual({
      date: "2026-09-02",
      supportCount: 2,
      engineeringCount: 0,
    });
  });

  it("buckets by the organization's timezone, matching bucketBreachesByDay's contract", () => {
    // 23:30 Los Angeles (UTC-7 in September) on the 1st is 06:30 UTC on the 2nd.
    const points = bucketBreachesByDayAndLeg(
      [{ breachedAt: new Date("2026-09-02T06:30:00.000Z"), leg: "engineering" }],
      periodStart,
      asOf,
      "America/Los_Angeles",
    );
    expect(points.find((p) => p.engineeringCount > 0)).toEqual({
      date: "2026-09-01",
      supportCount: 0,
      engineeringCount: 1,
    });
  });
});
