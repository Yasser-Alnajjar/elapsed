import { describe, expect, it } from "vitest";
import { isStalled } from "../src/watchdog";

describe("isStalled", () => {
  it("does not fire for work that is merely a little late", () => {
    expect(isStalled(5_000, 10_000)).toBe(false); // half an interval
    expect(isStalled(19_000, 10_000)).toBe(false); // still under the 60s floor
  });

  it("fires once the most overdue organization is more than two intervals late (the old 3x-since-last-run rule)", () => {
    expect(isStalled(61_000, 10_000)).toBe(true); // floor applies to short intervals
    expect(isStalled(2 * 30 * 60_000 - 1, 30 * 60_000)).toBe(false);
    expect(isStalled(2 * 30 * 60_000 + 1, 30 * 60_000)).toBe(true);
  });
});
