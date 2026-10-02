import { describe, expect, it } from "vitest";
import { staleFields } from "@/lib/freshness-data";

// 30 s poll × grace 3 = 90 s, the shipped default.
const settings = { activePollIntervalMs: 30_000, freshnessGraceFactor: 3 };
const asOf = "2026-10-01T12:00:00.000Z";
const ago = (ms: number) => new Date(new Date(asOf).getTime() - ms);

describe("staleFields (Blind Spots / operator stale rule, N3.8–N3.9)", () => {
  it("is fresh inside the window, even with no error recorded", () => {
    expect(staleFields({ status: "connected", lastSuccessfulSyncAt: ago(90_000) }, asOf, settings)).toEqual({
      stale: false,
      staleSince: null,
    });
  });

  it("is stale past the window with the instant it went stale, derived from the worker settings", () => {
    expect(staleFields({ status: "connected", lastSuccessfulSyncAt: ago(10 * 60_000) }, asOf, settings)).toEqual({
      stale: true,
      staleSince: ago(10 * 60_000 - 90_000).toISOString(),
    });
  });

  it("follows the configured cadence and grace factor, not a hardcoded one", () => {
    const slow = { activePollIntervalMs: 5 * 60_000, freshnessGraceFactor: 3 };
    expect(staleFields({ status: "connected", lastSuccessfulSyncAt: ago(10 * 60_000) }, asOf, slow).stale).toBe(false);
  });

  it("never-synced is stale with no stale-since instant (not a ticking 'now')", () => {
    expect(staleFields({ status: "connected", lastSuccessfulSyncAt: null }, asOf, settings)).toEqual({
      stale: true,
      staleSince: null,
    });
  });

  it("a disconnected integration is never stale", () => {
    expect(staleFields({ status: "disconnected", lastSuccessfulSyncAt: null }, asOf, settings)).toEqual({
      stale: false,
      staleSince: null,
    });
  });
});
