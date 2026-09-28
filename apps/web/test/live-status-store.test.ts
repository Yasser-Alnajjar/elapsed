/**
 * `live-status-store` — the tiny module-level pub-sub that lets the header
 * badge (`LiveStatusBadge`) and the Monitoring page's own "SSE connection"
 * row read the same live-connection state that `LiveDataProvider` (invisible,
 * owning the actual SSE connection) writes to, without either needing a ref
 * to the other or props threaded through the layout. `vi.resetModules()`
 * between tests since it's genuinely a module-level singleton.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("live-status-store", () => {
  it("starts \"reconnecting\", never a fabricated \"connected\"", async () => {
    const { getLiveStatus, getServerLiveStatusSnapshot } = await import("../src/lib/live-status-store");
    expect(getLiveStatus()).toBe("reconnecting");
    expect(getServerLiveStatusSnapshot()).toBe("reconnecting");
  });

  it("notifies subscribers when the status actually changes", async () => {
    const { setLiveStatus, getLiveStatus, subscribeLiveStatus } = await import("../src/lib/live-status-store");
    const listener = vi.fn();
    subscribeLiveStatus(listener);

    setLiveStatus("connected");

    expect(getLiveStatus()).toBe("connected");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("never notifies for a same-value update (no duplicate status events)", async () => {
    const { setLiveStatus, subscribeLiveStatus } = await import("../src/lib/live-status-store");
    const listener = vi.fn();
    setLiveStatus("connected");
    subscribeLiveStatus(listener);

    setLiveStatus("connected");

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying a listener once it unsubscribes", async () => {
    const { setLiveStatus, subscribeLiveStatus } = await import("../src/lib/live-status-store");
    const listener = vi.fn();
    const unsubscribe = subscribeLiveStatus(listener);
    unsubscribe();

    setLiveStatus("offline");

    expect(listener).not.toHaveBeenCalled();
  });

  it("tracks the SSE transport's own open/closed state independently of the combined status", async () => {
    const { setSseTransportOpen, getSseTransportOpen, getServerSseTransportSnapshot } = await import(
      "../src/lib/live-status-store"
    );
    expect(getSseTransportOpen()).toBe(false);
    expect(getServerSseTransportSnapshot()).toBe(false);

    setSseTransportOpen(true);
    expect(getSseTransportOpen()).toBe(true);
  });
});
