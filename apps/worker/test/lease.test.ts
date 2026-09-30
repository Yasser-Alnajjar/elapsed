import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedWork } from "@sla/db";
import { createLogger } from "@sla/logger";
import { LeaseLostError, startLeaseKeeper, type LeaseStore } from "../src/lease";

vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "warn").mockImplementation(() => undefined);

const claim: ClaimedWork = {
  organizationId: "org_1",
  kind: "active",
  leaseOwner: "worker-a",
  leaseToken: 7n,
  leaseTtlMs: 60_000,
  startedAt: new Date(),
  recoveredFromOwner: null,
};

let clock = 0;
const now = () => clock;
const logger = createLogger();

function store(overrides: Partial<LeaseStore> = {}): LeaseStore & { renew: ReturnType<typeof vi.fn>; isHeld: ReturnType<typeof vi.fn> } {
  return {
    renew: vi.fn(async () => true),
    isHeld: vi.fn(async () => true),
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => vi.useRealTimers());

/** Advances both the fake timers and the monotonic clock the keeper reads. */
async function advance(ms: number) {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
}

describe("lease keeper", () => {
  it("renews at a third of the TTL and stays valid across many TTLs", async () => {
    const s = store();
    const keeper = startLeaseKeeper({ claim, store: s, logger, now });
    await advance(200_000);
    expect(s.renew.mock.calls.length).toBeGreaterThanOrEqual(9); // every 20s
    expect(keeper.isValid()).toBe(true);
    expect(() => keeper.assertValid()).not.toThrow();
    keeper.stop();
  });

  it("stops renewing once stopped", async () => {
    const s = store();
    const keeper = startLeaseKeeper({ claim, store: s, logger, now });
    await advance(25_000);
    keeper.stop();
    const calls = s.renew.mock.calls.length;
    await advance(120_000);
    expect(s.renew.mock.calls.length).toBe(calls);
  });

  it("treats a rejected renewal (another worker holds it) as lease loss and stops renewing", async () => {
    const s = store({ renew: vi.fn(async () => false) });
    const keeper = startLeaseKeeper({ claim, store: s, logger, now });
    await advance(21_000);
    expect(keeper.isValid()).toBe(false);
    expect(keeper.lostReason()).toMatch(/taken over/);
    expect(() => keeper.assertValid()).toThrow(LeaseLostError);
    const calls = s.renew.mock.calls.length;
    await advance(60_000);
    expect(s.renew.mock.calls.length).toBe(calls);
  });

  it("survives a transient renewal failure but expires by its own clock if the database stays unreachable", async () => {
    const s = store({ renew: vi.fn(async () => Promise.reject(new Error("connection refused"))) });
    const keeper = startLeaseKeeper({ claim, store: s, logger, now });
    await advance(40_000); // two failed renewals: still inside the TTL
    expect(keeper.isValid()).toBe(true);
    await advance(20_000); // 60s since the last success, minus the safety margin
    expect(keeper.isValid()).toBe(false);
    expect(() => keeper.assertValid()).toThrow(/outlived its TTL/);
  });

  it("a paused process notices on resume: the local clock has passed the TTL even though no renewal ran", async () => {
    const s = store();
    const keeper = startLeaseKeeper({ claim, store: s, logger, now });
    // The event loop is frozen for 90s (GC / SIGSTOP): time passes, no timer callbacks run.
    clock += 90_000;
    expect(() => keeper.assertValid()).toThrow(LeaseLostError);
    keeper.stop();
  });

  it("assertHeld verifies against the database and fences out a stale holder", async () => {
    const s = store({ isHeld: vi.fn(async () => false) });
    const keeper = startLeaseKeeper({ claim, store: s, logger, now });
    await expect(keeper.assertHeld()).rejects.toThrow(LeaseLostError);
    expect(keeper.isValid()).toBe(false); // remembered, so later local checks fail without a round trip
    keeper.stop();
  });

  it("assertHeld refuses to proceed on a guess when ownership cannot be verified", async () => {
    const s = store({ isHeld: vi.fn(async () => Promise.reject(new Error("db down"))) });
    const keeper = startLeaseKeeper({ claim, store: s, logger, now });
    await expect(keeper.assertHeld()).rejects.toThrow(/could not be verified/);
    keeper.stop();
  });

  it("abandon() makes every later check throw (graceful shutdown past its deadline)", async () => {
    const keeper = startLeaseKeeper({ claim, store: store(), logger, now });
    keeper.abandon("worker shutting down");
    expect(() => keeper.assertValid()).toThrow(/shutting down/);
    await expect(keeper.assertHeld()).rejects.toThrow(LeaseLostError);
  });
});
