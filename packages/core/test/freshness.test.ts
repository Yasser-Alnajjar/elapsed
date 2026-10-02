import { describe, expect, it } from "vitest";
import { assessFreshness } from "../src/freshness";

describe("assessFreshness", () => {
  it("uses three active-poll intervals by default", () => {
    expect(assessFreshness({ lastSuccessfulSyncAt: "2026-01-01T00:00:00Z", asOf: "2026-01-01T00:15:00Z", expectedIntervalMs: 5 * 60_000 })).toEqual({ fresh: true, staleSince: null });
    expect(assessFreshness({ lastSuccessfulSyncAt: "2026-01-01T00:00:00Z", asOf: "2026-01-01T00:15:00.001Z", expectedIntervalMs: 5 * 60_000 })).toEqual({ fresh: false, staleSince: "2026-01-01T00:15:00.000Z" });
  });

  it("marks a never-successful integration stale at the observation instant", () => {
    expect(assessFreshness({ lastSuccessfulSyncAt: null, asOf: "2026-01-01T00:00:00Z", expectedIntervalMs: 60_000 })).toEqual({ fresh: false, staleSince: "2026-01-01T00:00:00.000Z" });
  });
});
