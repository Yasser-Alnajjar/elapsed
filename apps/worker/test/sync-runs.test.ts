import { describe, expect, it, vi } from "vitest";
import { IngestAbortedError, NormalizationAbortedError, type IngestResult, type ProjectionResult } from "@sla/ingestion";
import { classifyRun, dataChanged, failureCountOf, isNoChangeRun, recordSyncRun, type RunFacts } from "../src/sync-runs";

const projection = (overrides: Partial<ProjectionResult> = {}): ProjectionResult => ({
  customersUpserted: 5,
  customersChanged: 0,
  casesUpserted: 36,
  casesChanged: 0,
  casesDeleted: 0,
  eventsDerived: 90,
  eventsCreated: 0,
  eventsDeleted: 0,
  failures: [],
  ...overrides,
});

const ingest = (overrides: Partial<IngestResult> = {}): IngestResult => ({ recordsFetched: 40, counts: {}, ...overrides });

const facts = (overrides: Partial<RunFacts> = {}): RunFacts => ({
  ingestError: null,
  ingestResult: ingest(),
  normalizeError: null,
  normalization: projection(),
  ...overrides,
});

describe("dataChanged (D32)", () => {
  it("is false when many records were processed but nothing differs", () => {
    expect(dataChanged(facts())).toBe(false);
  });

  it.each([
    ["a changed case", { casesChanged: 1 }],
    ["a changed customer", { customersChanged: 1 }],
    ["a deleted case", { casesDeleted: 1 }],
    ["a created event", { eventsCreated: 1 }],
    ["a deleted event", { eventsDeleted: 1 }],
  ])("is true for %s", (_name, change) => {
    expect(dataChanged(facts({ normalization: projection(change) }))).toBe(true);
  });

  it("counts links, calendars and policies, and ignores a pass that threw", () => {
    expect(dataChanged(facts({ correlation: { created: 0, reactivated: 0, updated: 0, unlinked: 1, evaluated: 3, unmatched: {} } }))).toBe(true);
    expect(dataChanged(facts({ correlation: { created: 0, reactivated: 0, updated: 0, unlinked: 0, evaluated: 3, unmatched: {} } }))).toBe(false);
    expect(dataChanged(facts({ calendarImport: { schedulesEvaluated: 1, calendarVersionsCreated: 1, schedulesWithUnresolvedTimeZone: 0 } }))).toBe(true);
    const policyImport = { policiesEvaluated: 2, policyVersionsCreated: 0, unsupportedConditions: 0, unsupportedMetrics: 0, policiesWithNoUsableTargets: 0, policiesWithUnresolvedSchedule: 0, policiesArchived: 1 };
    expect(dataChanged(facts({ policyImport }))).toBe(true);
    expect(dataChanged(facts({ normalization: null, normalizeError: new Error("boom") }))).toBe(false);
  });
});

describe("isNoChangeRun (D32)", () => {
  const ok = (f: RunFacts) => isNoChangeRun(classifyRun(f), f);

  it("skips only a successful run that changed nothing and recorded no failure", () => {
    expect(ok(facts())).toBe(true);
    expect(ok(facts({ normalization: projection({ casesChanged: 1 }) }))).toBe(false);
  });

  it("keeps a run with a ticket-level failure from the projection or the ingest, even with no change", () => {
    const projectionFailure = facts({ normalization: projection({ failures: [{ id: "T-1", error: "bad_field" }] }) });
    expect(failureCountOf(projectionFailure)).toBe(1);
    expect(ok(projectionFailure)).toBe(false);
    const ingestFailure = facts({ ingestResult: ingest({ syncRun: { requests: 1, bytes: 1, recordFailures: [], recordFailureCount: 3 } }) });
    expect(ok(ingestFailure)).toBe(false);
  });

  it("keeps failed, partial and aborted runs even though they changed nothing", () => {
    expect(ok(facts({ ingestError: new Error("500") }))).toBe(false);
    expect(ok(facts({ ingestResult: ingest({ partial: { reason: "budget_exhausted" } }) }))).toBe(false);
    expect(ok(facts({ ingestError: new IngestAbortedError("flag_disabled") }))).toBe(false);
    expect(ok(facts({ normalization: null, normalizeError: new NormalizationAbortedError("mass_lifecycle_change", {}) }))).toBe(false);
    expect(ok(facts({ normalization: null, normalizeError: new Error("projection failed") }))).toBe(false);
  });
});

describe("recordSyncRun (D32)", () => {
  const input = (f: RunFacts, finishedAt?: Date) => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { integrationSyncRun: { create } } as never;
    return { create, run: () => recordSyncRun(prisma, { organizationId: "o", integrationId: "i", startedAt: new Date(), facts: f, classified: classifyRun(f), finishedAt }) };
  };

  it("writes nothing for a no-change run, however many times it repeats", async () => {
    const { create, run } = input(facts());
    expect(await run()).toBe(false);
    expect(await run()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("stores a changed run with the actual number of cases changed and the shared finish time", async () => {
    const finishedAt = new Date("2026-10-09T12:00:00Z");
    const { create, run } = input(facts({ normalization: projection({ casesChanged: 2, eventsCreated: 3 }) }), finishedAt);
    expect(await run()).toBe(true);
    expect(create.mock.calls[0]![0].data).toMatchObject({ outcome: "ok", casesWritten: 2, eventsWritten: 3, finishedAt, failureCount: 0 });
  });

  it("stores a failed run with its code and a ticket-failure run with its details", async () => {
    const failed = input(facts({ ingestError: Object.assign(new Error("x"), { code: "bad_response" }), ingestResult: null, normalization: null }));
    await failed.run();
    expect(failed.create.mock.calls[0]![0].data).toMatchObject({ outcome: "failed", reasonCode: "bad_response" });

    const tickets = input(facts({ normalization: projection({ failures: [{ id: "T-9", error: "mapping_error", details: [{ mapping: "status", target: "status", reason: "unmapped", message: "m" }] }] }) }));
    await tickets.run();
    const data = tickets.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ outcome: "ok", failureCount: 1 });
    expect(data.failures).toEqual([{ recordId: "T-9", code: "mapping_error", details: [{ mapping: "status", target: "status", reason: "unmapped", message: "m" }] }]);
  });
});
