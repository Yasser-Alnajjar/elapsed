import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_CASE_CEILING,
  exceedsCeiling,
  exceedsLifecycleChange,
  exceedsMassDeletion,
  exceedsRecordFailure,
  firstFiringGuard,
  liveCaseCeiling,
  type GuardCounts,
} from "../src/guards";

const counts = (overrides: Partial<GuardCounts> = {}): GuardCounts => ({ L: 1000, B: 100, F: 0, D: 0, R: 0, N: 0, C: 5000, ...overrides });

describe("failed-records guard (Q2): F >= 3 and F > 0.25 x B, every row of the plan 09 §6.4 table", () => {
  it.each([
    [1, 1, false],
    [2, 2, false],
    [4, 1, false],
    [8, 2, false],
    [3, 3, true],
    [8, 3, true],
    [11, 3, true],
    [12, 3, false],
    [12, 4, true],
    [100, 25, false],
    [100, 26, true],
  ])("B=%i F=%i aborts=%s", (B, F, aborts) => {
    expect(exceedsRecordFailure(counts({ B, F }))).toBe(aborts);
    expect(firstFiringGuard(counts({ B, F }))).toBe(aborts ? "mass_record_failure" : null);
  });

  it("never aborts with no failures, even for an empty pass", () => {
    expect(exceedsRecordFailure(counts({ B: 0, F: 0 }))).toBe(false);
  });
});

describe("lifecycle guard (Q3, Q11): R >= 10 and R > 0.25 x L, every row of the plan 09 §6.4 table", () => {
  it.each([
    [8, 8, false],
    [30, 9, false],
    [20, 10, true],
    [39, 10, true],
    [40, 10, false],
    [40, 11, true],
    [100, 25, false],
    [100, 26, true],
  ])("L=%i R=%i aborts=%s", (L, R, aborts) => {
    expect(exceedsLifecycleChange(counts({ L, R }))).toBe(aborts);
    expect(firstFiringGuard(counts({ L, R }))).toBe(aborts ? "mass_lifecycle_change" : null);
  });

  it("R < 10 never aborts even when R > 0.25 x L; R = 10 is the boundary", () => {
    expect(exceedsLifecycleChange(counts({ L: 12, R: 9 }))).toBe(false);
    expect(exceedsLifecycleChange(counts({ L: 12, R: 10 }))).toBe(true);
    expect(exceedsLifecycleChange(counts({ L: 1, R: 1 }))).toBe(false);
  });

  it("is skipped only by the explicit override flag, and the override leaves a deletion or failure abort in force", () => {
    const flipped = counts({ L: 20, R: 15 });
    expect(firstFiringGuard(flipped)).toBe("mass_lifecycle_change");
    expect(firstFiringGuard(flipped, { lifecycleOverridden: true })).toBeNull();
    expect(firstFiringGuard(flipped, { lifecycleOverridden: false })).toBe("mass_lifecycle_change");
  });
});

describe("deletion guard: D > max(3, 0.05 x L), no rounding", () => {
  it.each([
    [0, 0, false],
    [3, 10, false], // floor of 3
    [4, 10, true],
    [3, 60, false], // 5% of 60 is 3, not more than the floor
    [100, 2000, false], // 5% of 2000 = 100 exactly
    [101, 2000, true],
    [5, 101, false], // L = 101: threshold is 5.05
    [6, 101, true],
  ])("D=%i L=%i aborts=%s", (D, L, aborts) => {
    expect(exceedsMassDeletion(counts({ D, L }))).toBe(aborts);
    expect(firstFiringGuard(counts({ D, L }))).toBe(aborts ? "mass_deletion" : null);
  });

  it("can never be skipped: the lifecycle override has no effect on it", () => {
    expect(firstFiringGuard(counts({ D: 50, L: 100 }), { lifecycleOverridden: true })).toBe("mass_deletion");
  });
});

describe("live-case ceiling (Q13): L + N > C", () => {
  it("L + N = C is allowed and C + 1 fails safely", () => {
    expect(exceedsCeiling(counts({ L: 4000, N: 1000, C: 5000 }))).toBe(false);
    expect(exceedsCeiling(counts({ L: 4000, N: 1001, C: 5000 }))).toBe(true);
    expect(firstFiringGuard(counts({ L: 4000, N: 1001, C: 5000 }))).toBe("live_case_ceiling");
  });

  it("uses the configured value, not a literal: a different C moves the boundary", () => {
    expect(exceedsCeiling(counts({ L: 100, N: 0, C: 100 }))).toBe(false);
    expect(exceedsCeiling(counts({ L: 101, N: 0, C: 100 }))).toBe(true);
    expect(exceedsCeiling(counts({ L: 9_999, N: 1, C: 10_000 }))).toBe(false);
  });

  it("cannot be skipped by the lifecycle override", () => {
    expect(firstFiringGuard(counts({ L: 6000, N: 0, C: 5000 }), { lifecycleOverridden: true })).toBe("live_case_ceiling");
  });
});

describe("guard order", () => {
  it("evaluates the ceiling, then deletion, then record failure, then lifecycle", () => {
    const all = counts({ L: 100, N: 10_000, C: 5000, D: 90, B: 10, F: 9, R: 90 });
    expect(firstFiringGuard(all)).toBe("live_case_ceiling");
    expect(firstFiringGuard({ ...all, N: 0 })).toBe("mass_deletion");
    expect(firstFiringGuard({ ...all, N: 0, D: 0 })).toBe("mass_record_failure");
    expect(firstFiringGuard({ ...all, N: 0, D: 0, F: 0 })).toBe("mass_lifecycle_change");
    expect(firstFiringGuard({ ...all, N: 0, D: 0, F: 0, R: 0 })).toBeNull();
  });

  it("returns null for an ordinary pass", () => {
    expect(firstFiringGuard(counts({ L: 500, B: 500, F: 2, D: 3, R: 9, N: 20 }))).toBeNull();
  });
});

describe("liveCaseCeiling (configuration)", () => {
  it("defaults to the 1,000 Beta safeguard (OD-08) when unset or invalid", () => {
    expect(DEFAULT_LIVE_CASE_CEILING).toBe(1000);
    for (const value of [undefined, "", "abc", "0", "-5", "1.5", "100001", "NaN", "Infinity"]) {
      expect(liveCaseCeiling({ CUSTOM_PROVIDER_LIVE_CASE_CEILING: value })).toBe(1000);
    }
  });

  it("reads a valid integer from the environment, up to 100,000", () => {
    expect(liveCaseCeiling({ CUSTOM_PROVIDER_LIVE_CASE_CEILING: "1000" })).toBe(1000);
    expect(liveCaseCeiling({ CUSTOM_PROVIDER_LIVE_CASE_CEILING: "1" })).toBe(1);
    expect(liveCaseCeiling({ CUSTOM_PROVIDER_LIVE_CASE_CEILING: "100000" })).toBe(100_000);
    expect(liveCaseCeiling({})).toBe(1000);
  });
});
