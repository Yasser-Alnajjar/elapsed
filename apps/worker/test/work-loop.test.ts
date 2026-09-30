import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedWork } from "@sla/db";
import { createLogger } from "@sla/logger";
import { LeaseLostError } from "../src/lease";
import { startWorkLoop, type WorkLoopOptions } from "../src/work-loop";
import type { WorkStore } from "../src/work-store";

for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => undefined);

const logger = createLogger();
let tokenSeq = 0;
const makeClaim = (organizationId: string, kind: ClaimedWork["kind"] = "active"): ClaimedWork => ({
  organizationId,
  kind,
  leaseOwner: "w1",
  leaseToken: BigInt(++tokenSeq),
  leaseTtlMs: 60_000,
  startedAt: new Date(),
  recoveredFromOwner: null,
});

/** A store that hands out whatever is queued, honoring the requested limit, and records every call. */
function fakeStore(queue: ClaimedWork[]) {
  const calls = { claimLimits: [] as number[], completed: [] as string[], released: [] as string[], fenced: new Set<string>() };
  const store: WorkStore = {
    ensure: vi.fn(async () => 0),
    claim: vi.fn(async (limit: number) => {
      calls.claimLimits.push(limit);
      return queue.splice(0, limit);
    }),
    complete: vi.fn(async (claim) => {
      calls.completed.push(claim.organizationId);
      return !calls.fenced.has(claim.organizationId);
    }),
    release: vi.fn(async (claim) => {
      calls.released.push(claim.organizationId);
      return true;
    }),
    renew: vi.fn(async () => true),
    isHeld: vi.fn(async () => true),
    msUntilNextClaimable: vi.fn(async () => 50),
  };
  return { store, calls };
}

const intervals = async () => ({ activeIntervalMs: 10_000, reconciliationIntervalMs: 1_800_000 });
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loopWith(overrides: Partial<WorkLoopOptions> & Pick<WorkLoopOptions, "store" | "process">) {
  return startWorkLoop({ workerId: "w1", capacity: 3, leaseTtlMs: 60_000, claimPollMs: 20, logger, intervals, ...overrides });
}

beforeEach(() => {
  tokenSeq = 0;
});

describe("work loop", () => {
  it("never runs more than `capacity` organizations at once, and only asks for as many as it has room for", async () => {
    const queue = Array.from({ length: 10 }, (_, i) => makeClaim(`org_${i}`));
    const { store, calls } = fakeStore(queue);
    let running = 0;
    let max = 0;
    const loop = loopWith({
      store,
      process: async () => {
        running += 1;
        max = Math.max(max, running);
        await tick(40);
        running -= 1;
        return { failures: 0 };
      },
    });
    await vi.waitFor(() => expect(loop.stats().completed).toBe(10), { timeout: 5000 });
    await loop.stop(1000);
    expect(max).toBe(3);
    expect(loop.stats().peakRunning).toBe(3);
    expect(Math.max(...calls.claimLimits)).toBe(3);
    expect(calls.completed).toHaveLength(10);
  });

  it("claims again the moment a slot frees instead of waiting out the poll interval", async () => {
    const queue = [makeClaim("slow"), makeClaim("fast1"), makeClaim("fast2"), makeClaim("next")];
    const { store } = fakeStore(queue);
    const startedAt: Record<string, number> = {};
    const t0 = Date.now();
    const loop = loopWith({
      store,
      claimPollMs: 5_000, // far longer than the test: only a completion signal can wake the loop
      capacity: 3,
      process: async (claim) => {
        startedAt[claim.organizationId] = Date.now() - t0;
        await tick(claim.organizationId === "slow" ? 500 : 30);
        return { failures: 0 };
      },
    });
    await vi.waitFor(() => expect(startedAt.next).toBeDefined(), { timeout: 3000 });
    expect(startedAt.next).toBeLessThan(400); // started when "fast1" finished, not when "slow" did
    await loop.stop(2000);
  });

  it("records a thrown error as a failed run and keeps going", async () => {
    const { store } = fakeStore([makeClaim("boom"), makeClaim("fine")]);
    const loop = loopWith({
      store,
      process: async (claim) => {
        if (claim.organizationId === "boom") throw new Error("kaboom");
        return { failures: 0 };
      },
    });
    await vi.waitFor(() => expect(loop.stats().completed).toBe(2), { timeout: 3000 });
    const outcomes = vi.mocked(store.complete).mock.calls.map(([claim, outcome]) => [claim.organizationId, outcome.failed, outcome.error]);
    expect(outcomes).toContainEqual(["boom", true, "kaboom"]);
    expect(outcomes).toContainEqual(["fine", false, null]);
    expect(loop.stats().failedRuns).toBe(1);
    await loop.stop(1000);
  });

  it("records stage failures from a normally-finished run as failed, carrying the message", async () => {
    const { store } = fakeStore([makeClaim("org_1")]);
    const loop = loopWith({ store, process: async () => ({ failures: 2, error: "ingest:zendesk: 429" }) });
    await vi.waitFor(() => expect(loop.stats().completed).toBe(1), { timeout: 3000 });
    expect(vi.mocked(store.complete).mock.calls[0]![1]).toMatchObject({ failed: true, error: "ingest:zendesk: 429" });
    await loop.stop(1000);
  });

  it("a run that lost its lease records nothing and is counted as lease-lost", async () => {
    const { store } = fakeStore([makeClaim("org_1")]);
    const loop = loopWith({
      store,
      process: async (claim) => {
        throw new LeaseLostError(claim.organizationId, "taken over");
      },
    });
    await vi.waitFor(() => expect(loop.stats().leaseLost).toBe(1), { timeout: 3000 });
    expect(store.complete).not.toHaveBeenCalled();
    expect(loop.stats().completed).toBe(0);
    await loop.stop(1000);
  });

  it("a completion the database fences out is not reported as recorded", async () => {
    const { store, calls } = fakeStore([makeClaim("org_1")]);
    calls.fenced.add("org_1");
    const onRunRecorded = vi.fn(async () => undefined);
    const loop = loopWith({ store, onRunRecorded, process: async () => ({ failures: 0 }) });
    await vi.waitFor(() => expect(loop.stats().fencedCompletions).toBe(1), { timeout: 3000 });
    expect(onRunRecorded).not.toHaveBeenCalled();
    expect(loop.stats().completed).toBe(0);
    await loop.stop(1000);
  });

  it("reports recovered leases", async () => {
    const recovered = { ...makeClaim("org_1"), recoveredFromOwner: "dead-worker" };
    const { store } = fakeStore([recovered]);
    const loop = loopWith({ store, process: async () => ({ failures: 0 }) });
    await vi.waitFor(() => expect(loop.stats().recoveredLeases).toBe(1), { timeout: 3000 });
    await loop.stop(1000);
  });

  describe("shutdown", () => {
    it("stops claiming at once, waits for in-flight work to finish and record, and releases nothing", async () => {
      const { store, calls } = fakeStore([makeClaim("a"), makeClaim("b")]);
      let finished = 0;
      const loop = loopWith({
        store,
        process: async () => {
          await tick(150);
          finished += 1;
          return { failures: 0 };
        },
      });
      await vi.waitFor(() => expect(loop.stats().running).toBe(2), { timeout: 3000 });
      const claimsBefore = vi.mocked(store.claim).mock.calls.length;
      const result = await loop.stop(2000);
      expect(result.abandoned).toBe(0);
      expect(finished).toBe(2);
      expect(calls.completed.sort()).toEqual(["a", "b"]);
      expect(calls.released).toEqual([]);
      await tick(80);
      expect(vi.mocked(store.claim).mock.calls.length).toBeLessThanOrEqual(claimsBefore + 1); // no claiming after stop
    });

    it("past the grace period, abandons what is still running: lease marked lost locally and released in the database", async () => {
      const { store, calls } = fakeStore([makeClaim("stuck")]);
      let leaseError: unknown = null;
      const loop = loopWith({
        store,
        process: async (_claim, lease) => {
          await tick(400);
          try {
            lease.assertValid();
          } catch (error) {
            leaseError = error;
            throw error;
          }
          return { failures: 0 };
        },
      });
      await vi.waitFor(() => expect(loop.stats().running).toBe(1), { timeout: 3000 });
      const result = await loop.stop(50);
      expect(result.abandoned).toBe(1);
      expect(calls.released).toEqual(["stuck"]);
      await vi.waitFor(() => expect(leaseError).toBeInstanceOf(LeaseLostError), { timeout: 3000 });
      expect(calls.completed).toEqual([]); // the abandoned run publishes nothing
    });
  });

  it("survives claim errors and keeps looping", async () => {
    const { store } = fakeStore([makeClaim("org_1")]);
    let failures = 1;
    const realClaim = store.claim;
    store.claim = vi.fn(async (limit, ttl) => {
      if (failures-- > 0) throw new Error("db blip");
      return realClaim(limit, ttl);
    });
    const loop = loopWith({ store, process: async () => ({ failures: 0 }) });
    await vi.waitFor(() => expect(loop.stats().completed).toBe(1), { timeout: 6000 });
    await loop.stop(1000);
  });
});
