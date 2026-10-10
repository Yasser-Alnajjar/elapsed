/**
 * Plan 09 §6.12: the classification order and the "completed pages with record
 * failures" rows A to E, as a table over `classifyRun` / `failureCountOf`.
 */
import { describe, expect, it } from "vitest";
import { CustomIngestError } from "@sla/custom-ticket";
import {
  IngestAbortedError,
  NormalizationAbortedError,
  PermissionDeniedError,
  ReauthRequiredError,
  type IngestResult,
  type ProjectionResult,
} from "@sla/ingestion";
import { classifyRun, failureCountOf, type RunFacts } from "../src/sync-runs";

const projection = (failures = 0): ProjectionResult => ({
  customersUpserted: 1,
  customersChanged: 0,
  casesUpserted: 10,
  casesChanged: 0,
  casesDeleted: 0,
  eventsDerived: 10,
  eventsCreated: 0,
  eventsDeleted: 0,
  failures: Array.from({ length: failures }, (_, i) => ({ id: `T-${i}`, error: "x" })),
});
const ingest = (extra: Partial<IngestResult> = {}, failed = 0): IngestResult => ({
  recordsFetched: 10,
  counts: {},
  syncRun: { requests: 3, bytes: 10, recordFailures: Array.from({ length: failed }, (_, i) => ({ recordId: `T-${i}`, code: "missing_field" })), recordFailureCount: failed },
  ...extra,
});
const facts = (o: Partial<RunFacts> = {}): RunFacts => ({ ingestError: null, ingestResult: ingest(), normalizeError: null, normalization: projection(), ...o });
const partial = (reason: "budget_exhausted" | "run_cap_reached") => ({ partial: { reason, progress: {} } }) as Partial<IngestResult>;

describe("§6.12 classification order", () => {
  it("1: 401, 403, unreadable credentials and unexpected errors are failed runs under the existing policy", () => {
    for (const error of [new ReauthRequiredError("x"), new PermissionDeniedError("x"), new Error("boom")]) {
      expect(classifyRun(facts({ ingestError: error, ingestResult: null }))).toMatchObject({ outcome: "failed", leavesHealthAlone: false, success: false });
    }
  });

  it("2: a provider error that exhausted its retries is failed, even when the run also ran out of budget", () => {
    const result = classifyRun(facts({ ingestError: new CustomIngestError("provider_unavailable"), ingestResult: null }));
    expect(result).toMatchObject({ outcome: "failed", reasonCode: "provider_unavailable", leavesHealthAlone: false });
  });

  it("3: a guard abort in normalization is aborted, a normalization error is failed; both follow the failure policy", () => {
    expect(classifyRun(facts({ normalizeError: new NormalizationAbortedError("mass_deletion"), normalization: null }))).toMatchObject({
      outcome: "aborted",
      reasonCode: "mass_deletion",
      leavesHealthAlone: false,
      success: false,
    });
    expect(classifyRun(facts({ normalizeError: new Error("db"), normalization: null }))).toMatchObject({ outcome: "failed", leavesHealthAlone: false });
  });

  it("4: only the budget or a cap ended the run: partial, health counters untouched, not a success", () => {
    for (const reason of ["budget_exhausted", "run_cap_reached"] as const) {
      expect(classifyRun(facts({ ingestResult: ingest(partial(reason)) }))).toMatchObject({ outcome: "partial", reasonCode: reason, secondaryReason: null, leavesHealthAlone: true, success: false });
    }
  });

  it("5: the pass completed and normalization succeeded: ok and a success", () => {
    expect(classifyRun(facts())).toMatchObject({ outcome: "ok", reasonCode: null, leavesHealthAlone: false, success: true });
  });

  it("a stop on purpose (the Beta flag turned off) is aborted and touches no counters", () => {
    expect(classifyRun(facts({ ingestError: new IngestAbortedError("flag_disabled"), ingestResult: null }))).toMatchObject({ outcome: "aborted", reasonCode: "flag_disabled", leavesHealthAlone: true });
  });
});

describe("§6.12 completed pages with record failures (rows A to E)", () => {
  it("A: pass completes, failures below the guard: ok, a success, every failure counted", () => {
    const f = facts({ ingestResult: ingest({}, 2), normalization: projection(1) });
    expect(classifyRun(f)).toMatchObject({ outcome: "ok", success: true });
    expect(failureCountOf(f)).toBe(3);
  });

  it("B and E: budget or cap ends the run with failures below the guard: partial, no counter change, failures still reported", () => {
    const f = facts({ ingestResult: ingest(partial("budget_exhausted"), 2) });
    expect(classifyRun(f)).toMatchObject({ outcome: "partial", reasonCode: "budget_exhausted", leavesHealthAlone: true, success: false });
    expect(failureCountOf(f)).toBe(2);
  });

  it("C: budget stop and the failed-record guard fires on the pages read: aborted `mass_record_failure`, the partial reason is secondary, the failure policy applies", () => {
    const f = facts({
      ingestResult: ingest(partial("budget_exhausted"), 5),
      normalizeError: new NormalizationAbortedError("mass_record_failure"),
      normalization: null,
    });
    expect(classifyRun(f)).toMatchObject({
      outcome: "aborted",
      reasonCode: "mass_record_failure",
      secondaryReason: "budget_exhausted",
      leavesHealthAlone: false,
      success: false,
    });
  });

  it("D: a provider failure after completed pages is failed, whatever the pages contained", () => {
    const f = facts({ ingestError: new CustomIngestError("timeout"), ingestResult: null });
    expect(classifyRun(f)).toMatchObject({ outcome: "failed", reasonCode: "timeout", success: false, leavesHealthAlone: false });
  });
});
