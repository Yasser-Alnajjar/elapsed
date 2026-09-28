/**
 * `subscribeToLiveData`'s `LiveListenerStatus` state machine, against a fake
 * `pg.Client` (an `EventEmitter` whose `connect`/`query`/`end` behavior the
 * test controls) rather than real Postgres — this only needs to prove the
 * state transitions (connected/reconnecting/offline) and their timing, not
 * that `LISTEN`/`NOTIFY` itself works (that's `live-events.test.ts`, real
 * Postgres). Fake timers stand in for `RECONNECT_DELAY_MS`.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveListenerStatus } from "../src/live-events";

type Outcome = "ok" | "fail-connect" | "fail-listen";

const control = vi.hoisted(() => ({
  outcomes: [] as Outcome[],
  instances: [] as FakeClient[],
}));

class FakeClient extends EventEmitter {
  ended = false;
  constructor(_options: unknown) {
    super();
    control.instances.push(this);
  }
  async connect(): Promise<void> {
    const outcome = control.outcomes.shift() ?? "ok";
    if (outcome === "fail-connect") throw new Error("connection refused");
    (this as unknown as { __outcome: Outcome }).__outcome = outcome;
  }
  async query(sql: string): Promise<void> {
    if (sql.startsWith("LISTEN") && (this as unknown as { __outcome?: Outcome }).__outcome === "fail-listen") {
      throw new Error("listen failed");
    }
    // SELECT 1 heartbeat: succeeds unless the test kills this instance first.
    if (this.ended) throw new Error("connection is closed");
  }
  async end(): Promise<void> {
    this.ended = true;
    this.emit("end");
  }
}

vi.mock("pg", () => ({ default: { Client: FakeClient } }));

async function flush() {
  // Let queued microtasks (the `async connect()` chain) settle between timer advances.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  control.outcomes = [];
  control.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscribeToLiveData status", () => {
  it("reports \"connected\" once the initial connect+LISTEN succeeds", async () => {
    const { subscribeToLiveData } = await import("../src/live-events");
    const statuses: LiveListenerStatus[] = [];
    const sub = subscribeToLiveData(() => {}, {
      connectionString: "postgres://fake",
      onStatusChange: (s) => statuses.push(s),
    });

    await flush();

    expect(sub.getStatus().state).toBe("connected");
    expect(statuses.map((s) => s.state)).toEqual(["connected"]);
    expect(sub.getStatus().reconnectCount).toBe(0);

    await sub.close();
  });

  it("moves to \"reconnecting\" when a live connection is lost, then back to \"connected\" on reconnect", async () => {
    const { subscribeToLiveData } = await import("../src/live-events");
    const statuses: LiveListenerStatus[] = [];
    const sub = subscribeToLiveData(() => {}, {
      connectionString: "postgres://fake",
      onStatusChange: (s) => statuses.push(s),
    });
    await flush();
    expect(sub.getStatus().state).toBe("connected");

    control.instances[0]!.emit("error", new Error("connection reset"));
    await flush();
    expect(sub.getStatus().state).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(sub.getStatus().state).toBe("connected");
    expect(sub.getStatus().reconnectCount).toBe(1);
    expect(statuses.map((s) => s.state)).toEqual(["connected", "reconnecting", "connected"]);

    await sub.close();
  });

  it("escalates to \"offline\" after repeated reconnect-attempt failures, and never emits a duplicate same-state event", async () => {
    const { subscribeToLiveData } = await import("../src/live-events");
    const statuses: LiveListenerStatus[] = [];
    const sub = subscribeToLiveData(() => {}, {
      connectionString: "postgres://fake",
      onStatusChange: (s) => statuses.push(s),
    });
    await flush(); // initial connect succeeds
    expect(sub.getStatus().state).toBe("connected");

    control.instances[0]!.emit("error", new Error("connection reset"));
    await flush();
    expect(sub.getStatus().state).toBe("reconnecting");

    control.outcomes = ["fail-connect", "fail-connect", "fail-connect"];

    await vi.advanceTimersByTimeAsync(2_000);
    await flush(); // reconnect attempt 1 fails -> still "reconnecting" (no duplicate event for the same state)
    expect(sub.getStatus().state).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(2_000);
    await flush(); // reconnect attempt 2 fails -> still "reconnecting"
    expect(sub.getStatus().state).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(2_000);
    await flush(); // reconnect attempt 3 fails -> escalates to "offline"
    expect(sub.getStatus().state).toBe("offline");

    // Exactly two transitions fired across the whole failure run:
    // connected->reconnecting (the initial loss) and reconnecting->offline
    // (the third failed attempt) — never one per failed attempt.
    expect(statuses.map((s) => s.state)).toEqual(["connected", "reconnecting", "offline"]);

    await vi.advanceTimersByTimeAsync(2_000);
    await flush(); // reconnect attempt 4 succeeds -> back to "connected"

    expect(sub.getStatus().state).toBe("connected");
    expect(sub.getStatus().reconnectCount).toBe(1);
    expect(statuses.map((s) => s.state)).toEqual(["connected", "reconnecting", "offline", "connected"]);

    await sub.close();
  });

  it("never leaks a connection when LISTEN itself fails after a successful connect()", async () => {
    const { subscribeToLiveData } = await import("../src/live-events");
    control.outcomes = ["fail-listen"];
    const sub = subscribeToLiveData(() => {}, { connectionString: "postgres://fake" });

    await flush();

    expect(control.instances).toHaveLength(1);
    expect(control.instances[0]!.ended).toBe(true);

    await sub.close();
  });
});
