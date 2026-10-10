import { describe, expect, it } from "vitest";
import { RunBudget } from "../src/budget";
import { SafeHttpError } from "../src/errors";

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof SafeHttpError ? error.code : "other";
  }
  return "no_error";
}

describe("RunBudget (plan 09 §6.3, Q4)", () => {
  it("defaults to a 120 s budget, 1 s minimum useful time, 5 requests per second and 50 MB", () => {
    const budget = new RunBudget();
    expect(budget.totalMs).toBe(120_000);
    expect(budget.minUsefulMs).toBe(1_000);
    expect(budget.maxBytes).toBe(50 * 1024 * 1024);
    expect(budget.stopCheckIntervalMs).toBe(5_000);
  });

  it("counts down the wall clock and never reports a negative remainder", () => {
    const c = clock();
    const budget = new RunBudget({ totalMs: 10_000, now: c.now, sleep: c.sleep });
    expect(budget.remainingMs()).toBe(10_000);
    c.advance(4_000);
    expect(budget.remainingMs()).toBe(6_000);
    expect(budget.elapsedMs).toBe(4_000);
    c.advance(60_000);
    expect(budget.remainingMs()).toBe(0);
  });

  it("starts an attempt with exactly the minimum left, and refuses one millisecond less", async () => {
    const c = clock();
    const budget = new RunBudget({ totalMs: 10_000, minUsefulMs: 1_000, now: c.now, sleep: c.sleep });
    c.advance(9_000);
    await expect(budget.reserveRequestSlot()).resolves.toBeUndefined();
    c.advance(1);
    expect(await codeOf(budget.reserveRequestSlot())).toBe("budget_exhausted");
  });

  it("never begins an attempt at zero remaining", async () => {
    const c = clock();
    const budget = new RunBudget({ totalMs: 5_000, now: c.now, sleep: c.sleep });
    c.advance(5_000);
    expect(() => budget.assertCanStart()).toThrow(SafeHttpError);
    expect(await codeOf(budget.reserveRequestSlot())).toBe("budget_exhausted");
    expect(budget.requests).toBe(0);
  });

  it("spaces request starts at the configured rate", async () => {
    const c = clock();
    const budget = new RunBudget({ totalMs: 60_000, requestsPerSecond: 5, now: c.now, sleep: c.sleep });
    await budget.reserveRequestSlot();
    await budget.reserveRequestSlot();
    await budget.reserveRequestSlot();
    expect(c.now()).toBe(400); // slots at 0, 200, 400 ms
    expect(budget.requests).toBe(3);
  });

  it("ends the run instead of waiting for a slot that would leave less than a useful attempt", async () => {
    const c = clock();
    const budget = new RunBudget({ totalMs: 2_000, minUsefulMs: 1_000, requestsPerSecond: 0.5, now: c.now, sleep: c.sleep });
    await budget.reserveRequestSlot(); // slot 0
    // the next slot is 2 s away; waiting would leave 0 ms
    expect(await codeOf(budget.reserveRequestSlot())).toBe("budget_exhausted");
  });

  it("stops with run_cap_reached once the byte cap is exceeded (the cap itself is allowed)", () => {
    const budget = new RunBudget({ maxBytes: 100 });
    budget.addBytes(60);
    budget.addBytes(40);
    expect(budget.bytesRead).toBe(100);
    expect(() => budget.addBytes(1)).toThrowError(expect.objectContaining({ code: "run_cap_reached" }));
  });

  it("reports the caller's stop reason (the Beta flag) and throws stopped with it", async () => {
    let stop: string | null = null;
    const budget = new RunBudget({ checkStop: async () => stop });
    await expect(budget.assertNotStopped()).resolves.toBeUndefined();
    stop = "flag_disabled";
    expect(await budget.stopReason()).toBe("flag_disabled");
    await expect(budget.assertNotStopped()).rejects.toMatchObject({ code: "stopped", reason: "flag_disabled" });
  });

  it("has no stop reason without a stop check", async () => {
    expect(await new RunBudget().stopReason()).toBeNull();
  });
});
