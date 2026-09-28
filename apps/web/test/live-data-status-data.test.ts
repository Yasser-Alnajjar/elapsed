/**
 * `getLiveDataStatusView` — the Monitoring page's read model for the "Live
 * data" card. Just a Date->ISO mapping over `getLiveDataBus().getStatus()`
 * (mocked here), same convention as `worker-settings-data.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const bus = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock("../src/lib/live-data-bus", () => ({
  getLiveDataBus: () => bus,
}));

beforeEach(() => {
  vi.resetModules();
  bus.getStatus.mockReset();
});

describe("getLiveDataStatusView", () => {
  it("converts every timestamp to an ISO string and passes the rest through", async () => {
    bus.getStatus.mockReturnValue({
      state: "connected",
      lastConnectedAt: new Date("2026-01-01T00:00:00Z"),
      lastEventAt: new Date("2026-01-01T00:05:00Z"),
      lastErrorAt: new Date("2025-12-31T23:00:00Z"),
      lastErrorMessage: "connection reset",
      reconnectCount: 2,
    });

    const { getLiveDataStatusView } = await import("../src/lib/live-data-status-data");

    expect(getLiveDataStatusView()).toEqual({
      state: "connected",
      lastConnectedAt: "2026-01-01T00:00:00.000Z",
      lastEventAt: "2026-01-01T00:05:00.000Z",
      lastErrorAt: "2025-12-31T23:00:00.000Z",
      lastErrorMessage: "connection reset",
      reconnectCount: 2,
    });
  });

  it("passes null timestamps through as null instead of throwing", async () => {
    bus.getStatus.mockReturnValue({
      state: "reconnecting",
      lastConnectedAt: null,
      lastEventAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      reconnectCount: 0,
    });

    const { getLiveDataStatusView } = await import("../src/lib/live-data-status-data");

    expect(getLiveDataStatusView()).toEqual({
      state: "reconnecting",
      lastConnectedAt: null,
      lastEventAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      reconnectCount: 0,
    });
  });
});
