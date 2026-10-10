import { describe, expect, it } from "vitest";
import { attentionCause, deriveSyncState, type StateInput } from "@/lib/custom-provider/status";
import { ATTENTION_COPY } from "@/lib/custom-provider/state-copy";

const base: StateInput = { flagEnabled: true, pollingPaused: false, integrationStatus: "connected", backfillCompleted: true, runs: [] };
const withRun = (run: StateInput["runs"][number]): StateInput => ({ ...base, runs: [run] });

describe("guard aborts get their own message (OD-01)", () => {
  it.each([
    ["mass_deletion", "mass_deletion"],
    ["live_case_ceiling", "live_case_ceiling"],
    ["mass_record_failure", "mass_record_failure"],
  ] as const)("%s maps to its own cause", (reasonCode, cause) => {
    expect(attentionCause(withRun({ outcome: "aborted", reasonCode, progress: null }))).toBe(cause);
  });

  it("the lifecycle guard (the only overridable one) and unknown codes keep the generic safety-check message", () => {
    expect(attentionCause(withRun({ outcome: "aborted", reasonCode: "mass_lifecycle_change", progress: null }))).toBe("safety_check");
    expect(attentionCause(withRun({ outcome: "aborted", reasonCode: "something_new", progress: null }))).toBe("safety_check");
    expect(attentionCause(withRun({ outcome: "aborted", reasonCode: null, progress: null }))).toBe("safety_check");
  });

  it("a run aborted because the provider was switched off is not an attention state", () => {
    expect(attentionCause(withRun({ outcome: "aborted", reasonCode: "flag_disabled", progress: null }))).toBeNull();
  });

  it("every guard message says nothing was changed, and the deletion message does not offer an override", () => {
    for (const cause of ["mass_deletion", "live_case_ceiling", "mass_record_failure"] as const) {
      expect(ATTENTION_COPY[cause]).toMatch(/before any change was applied/);
      expect(ATTENTION_COPY[cause]).not.toBe(ATTENTION_COPY.safety_check);
    }
    expect(ATTENTION_COPY.mass_deletion).toMatch(/cannot be overridden/);
    expect(ATTENTION_COPY.mass_deletion).toMatch(/Nothing was deleted/);
    // The copy carries no figure that could drift from the configured ceiling.
    expect(ATTENTION_COPY.live_case_ceiling).not.toMatch(/\d/);
  });

  it("every guard abort is a Needs attention state", () => {
    for (const reasonCode of ["mass_deletion", "live_case_ceiling", "mass_record_failure", "mass_lifecycle_change"]) {
      expect(deriveSyncState(withRun({ outcome: "aborted", reasonCode, progress: null }))).toBe("needs_attention");
    }
  });
});

describe("§6.13 / R6 states for partial and failed runs", () => {
  it("a partial run on a source with an incremental cursor is Catching up, not an alert", () => {
    const input = withRun({ outcome: "partial", reasonCode: "budget_exhausted", progress: { hasIncrementalCursor: true } });
    expect(attentionCause(input)).toBeNull();
    expect(deriveSyncState(input)).toBe("catching_up");
  });

  it("a partial run on a source with no incremental cursor needs attention (it can never catch up)", () => {
    const input = withRun({ outcome: "partial", reasonCode: "run_cap_reached", progress: { hasIncrementalCursor: false } });
    expect(attentionCause(input)).toBe("cannot_finish_without_cursor");
    expect(deriveSyncState(input)).toBe("needs_attention");
  });

  it("an unfinished initial import is Importing history, never a failure", () => {
    const input: StateInput = { ...base, backfillCompleted: false, runs: [{ outcome: "partial", reasonCode: "budget_exhausted", progress: { hasIncrementalCursor: true } }] };
    expect(deriveSyncState(input)).toBe("importing_history");
  });

  it("a no_progress failure is its own cause, distinct from a provider failure", () => {
    expect(attentionCause(withRun({ outcome: "failed", reasonCode: "no_progress", progress: null }))).toBe("no_progress");
    expect(attentionCause(withRun({ outcome: "failed", reasonCode: "timeout", progress: null }))).toBe("provider");
    expect(ATTENTION_COPY.no_progress).not.toBe(ATTENTION_COPY.provider);
  });
});
