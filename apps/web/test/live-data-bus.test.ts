/**
 * `getLiveDataBus` — the per-process fan-out sitting between the one
 * dedicated Postgres `LISTEN` connection (`@sla/db`'s `subscribeToLiveData`,
 * mocked here) and however many `/api/live` requests this process is
 * currently serving. Covers organization isolation and that unsubscribing
 * actually stops delivery (no unbounded listener accumulation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveDataEvent } from "@sla/db";

// `server-only` throws unless bundled for React Server Components.
vi.mock("server-only", () => ({}));

const dbEvents = vi.hoisted(() => ({
  handler: null as ((event: LiveDataEvent) => void) | null,
  onStatusChange: null as ((status: unknown) => void) | null,
}));

// Mutated in place, mirroring `live-events.ts`'s own contract: it mutates its
// `status` object first, then calls `onStatusChange` — so `getStatus()`
// always already reflects whatever the most recent callback announced.
const fakeStatus: {
  state: "connected" | "reconnecting" | "offline";
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  reconnectCount: number;
} = {
  state: "connected",
  lastConnectedAt: new Date("2026-01-01T00:00:00Z"),
  lastErrorAt: null,
  lastErrorMessage: null,
  reconnectCount: 0,
};

vi.mock("@sla/db", () => ({
  subscribeToLiveData: vi.fn(
    (
      onEvent: (event: LiveDataEvent) => void,
      options?: { onStatusChange?: (status: unknown) => void },
    ) => {
      dbEvents.handler = onEvent;
      dbEvents.onStatusChange = options?.onStatusChange ?? null;
      return { close: vi.fn(), getStatus: () => fakeStatus };
    },
  ),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbEvents.handler = null;
  dbEvents.onStatusChange = null;
  fakeStatus.state = "connected";
  fakeStatus.lastErrorAt = null;
  fakeStatus.lastErrorMessage = null;
  fakeStatus.reconnectCount = 0;
  // `getLiveDataBus` stashes its singleton on `globalThis` (surviving
  // `vi.resetModules()`, on purpose, for `next dev` hot reload) — cleared
  // here so each test gets its own bus and its own `subscribeToLiveData` call.
  delete (globalThis as { __slaLiveBus?: unknown }).__slaLiveBus;
});

describe("getLiveDataBus", () => {
  it("delivers an event only to listeners subscribed to that organization", async () => {
    const { getLiveDataBus } = await import("../src/lib/live-data-bus");
    const bus = getLiveDataBus();

    const orgAListener = vi.fn();
    const orgBListener = vi.fn();
    bus.subscribe("org-a", orgAListener);
    bus.subscribe("org-b", orgBListener);

    dbEvents.handler!({ type: "data.updated", organizationId: "org-a" });

    expect(orgAListener).toHaveBeenCalledTimes(1);
    expect(orgBListener).not.toHaveBeenCalled();
  });

  it("fans out to every listener subscribed to the same organization", async () => {
    const { getLiveDataBus } = await import("../src/lib/live-data-bus");
    const bus = getLiveDataBus();

    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe("org-a", first);
    bus.subscribe("org-a", second);

    dbEvents.handler!({ type: "data.updated", organizationId: "org-a" });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops delivering to a listener once it unsubscribes", async () => {
    const { getLiveDataBus } = await import("../src/lib/live-data-bus");
    const bus = getLiveDataBus();

    const listener = vi.fn();
    const unsubscribe = bus.subscribe("org-a", listener);
    unsubscribe();

    dbEvents.handler!({ type: "data.updated", organizationId: "org-a" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("reuses the same underlying LISTEN connection across multiple subscribe calls", async () => {
    const { subscribeToLiveData } = await import("@sla/db");
    const { getLiveDataBus } = await import("../src/lib/live-data-bus");

    getLiveDataBus().subscribe("org-a", vi.fn());
    getLiveDataBus().subscribe("org-b", vi.fn());
    getLiveDataBus().subscribe("org-a", vi.fn());

    // One dedicated connection per process, not one per subscriber.
    expect(vi.mocked(subscribeToLiveData)).toHaveBeenCalledTimes(1);
  });

  it("reports the dedicated connection's status plus its own last-event-at", async () => {
    const { getLiveDataBus } = await import("../src/lib/live-data-bus");
    const bus = getLiveDataBus();

    expect(bus.getStatus()).toMatchObject({ state: "connected", lastEventAt: null });

    dbEvents.handler!({ type: "data.updated", organizationId: "org-a" });

    expect(bus.getStatus().lastEventAt).toBeInstanceOf(Date);
  });

  it("notifies status subscribers when the underlying connection's status changes", async () => {
    const { getLiveDataBus } = await import("../src/lib/live-data-bus");
    const bus = getLiveDataBus();

    const listener = vi.fn();
    bus.subscribeToStatus(listener);

    fakeStatus.state = "reconnecting";
    dbEvents.onStatusChange!(fakeStatus);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: "reconnecting" }));
  });

  it("stops notifying a status listener once it unsubscribes", async () => {
    const { getLiveDataBus } = await import("../src/lib/live-data-bus");
    const bus = getLiveDataBus();

    const listener = vi.fn();
    const unsubscribe = bus.subscribeToStatus(listener);
    unsubscribe();

    fakeStatus.state = "offline";
    dbEvents.onStatusChange!(fakeStatus);

    expect(listener).not.toHaveBeenCalled();
  });
});
