import { describe, expect, it } from "vitest";
import { DEFAULT_ORGANIZATION_CONCURRENCY, forEachWithConcurrency, normalizeConcurrency } from "../src/concurrency";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("forEachWithConcurrency", () => {
  it("never runs more than `limit` at once, runs every item exactly once, and reaches the limit", async () => {
    const items = Array.from({ length: 13 }, (_, i) => i);
    const seen: number[] = [];
    let inFlight = 0;
    let max = 0;
    await forEachWithConcurrency(items, 3, async (item) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      seen.push(item);
      await tick(5 + (item % 4) * 3);
      inFlight -= 1;
    });
    expect(max).toBe(3);
    expect([...seen].sort((a, b) => a - b)).toEqual(items);
  });

  it("starts the next item as soon as any slot frees, without waiting for a whole batch", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    await forEachWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      started.push(item);
      await tick(item === 0 ? 40 : 5);
      finished.push(item);
    });
    // Item 0 is slow: items 2 and 3 must start and finish while it is still running.
    expect(finished[finished.length - 1]).toBe(0);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it("handles fewer items than the limit and no items", async () => {
    let calls = 0;
    await forEachWithConcurrency([1], 5, async () => void (calls += 1));
    await forEachWithConcurrency([], 5, async () => void (calls += 1));
    expect(calls).toBe(1);
  });

  it("on a throw: starts nothing new, waits for in-flight items, then rethrows the first error", async () => {
    const started: number[] = [];
    let finishedInFlight = false;
    await expect(
      forEachWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item);
        if (item === 0) throw new Error("boom");
        await tick(20);
        finishedInFlight = true;
      }),
    ).rejects.toThrow("boom");
    expect(finishedInFlight).toBe(true);
    expect(started).toEqual([0, 1]);
  });
});

describe("normalizeConcurrency", () => {
  it("accepts positive integers and falls back to the default otherwise", () => {
    expect(normalizeConcurrency(5)).toBe(5);
    expect(normalizeConcurrency(1)).toBe(1);
    for (const bad of [undefined, 0, -2, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeConcurrency(bad)).toBe(DEFAULT_ORGANIZATION_CONCURRENCY);
    }
  });
});
