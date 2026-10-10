import { describe, expect, it } from "vitest";
import { isRunSuperseded } from "../src/supersession";

const at = (s: string) => new Date(`2026-10-09T${s}Z`);

describe("isRunSuperseded (D32)", () => {
  const failed = { startedAt: at("10:00:00"), finishedAt: at("10:00:05") };

  it("is false when nothing has ever succeeded", () => {
    expect(isRunSuperseded(failed, null)).toBe(false);
    expect(isRunSuperseded(failed, undefined)).toBe(false);
  });

  it("is false for a failure newer than the last clean check, so an unresolved failure is never hidden", () => {
    expect(isRunSuperseded(failed, at("09:59:00"))).toBe(false);
    expect(isRunSuperseded(failed, at("10:00:03"))).toBe(false);
  });

  it("is true once a clean check completes after the run finished", () => {
    expect(isRunSuperseded(failed, at("10:05:00"))).toBe(true);
  });

  it("never supersedes a stored successful run itself: its own finish time is the last clean check", () => {
    expect(isRunSuperseded(failed, at("10:00:05"))).toBe(false);
  });

  it("falls back to the start when a run has no finish time, and accepts ISO strings", () => {
    expect(isRunSuperseded({ startedAt: at("10:00:00"), finishedAt: null }, at("10:00:01"))).toBe(true);
    expect(isRunSuperseded({ startedAt: "2026-10-09T10:00:00.000Z" }, "2026-10-09T10:00:00.000Z")).toBe(false);
  });
});
