/**
 * The multi-worker behavior end to end against real Postgres: several work
 * loops (each standing in for a worker process, with its own owner id and
 * capacity) share one database and must split the organizations between them
 * without ever processing one twice at once; recover from a crashed worker;
 * fence out one that lost its lease; and keep per-organization cadence.
 *
 * Only the per-organization processing is faked (it sleeps and records) — the
 * claiming, leasing, scheduling SQL and loop are the real ones. Needs a
 * migrated database at TEST_DATABASE_URL whose name contains "test"; skipped
 * when unset.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedWork, PrismaClient } from "@sla/db";
import { createLogger } from "@sla/logger";
import { LeaseLostError, type LeaseGuard } from "../src/lease";
import { startWorkLoop, type WorkLoop, type WorkLoopOptions } from "../src/work-loop";
import { createDbWorkStore, type WorkStore } from "../src/work-store";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => undefined);

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Run {
  organizationId: string;
  workerId: string;
  kind: string;
  start: number;
  end: number;
}

describe.skipIf(!TEST_DATABASE_URL)("multi-worker work loop (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");
  const loops: WorkLoop[] = [];

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
  });

  afterEach(async () => {
    await Promise.all(loops.splice(0).map((loop) => loop.stop(0)));
  }, 20_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // Reset per test, so `since()` is "milliseconds into this test".
  let T0 = Date.now();
  const since = () => Date.now() - T0;
  beforeEach(() => {
    T0 = Date.now();
  });

  async function makeOrgs(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) ids.push((await prisma.organization.create({ data: { name: `Org ${i}` } })).id);
    await db.ensureOrganizationWorkStates(prisma, { reconciliationIntervalMs: 30 * 60_000 });
    await prisma.$executeRaw`UPDATE "organization_work_states" SET "reconciliationNextDueAt" = now() + interval '25 minutes'`;
    return ids;
  }

  function startWorker(
    workerId: string,
    process: WorkLoopOptions["process"],
    options: Partial<WorkLoopOptions> = {},
    store: WorkStore = createDbWorkStore(prisma, workerId),
  ): WorkLoop {
    const loop = startWorkLoop({
      workerId,
      capacity: 3,
      leaseTtlMs: 60_000,
      claimPollMs: 50,
      ensureEveryMs: 60_000,
      logger: createLogger({ workerId }),
      store,
      intervals: async () => ({ activeIntervalMs: 400, reconciliationIntervalMs: 30 * 60_000 }),
      process,
      ...options,
    });
    loops.push(loop);
    return loop;
  }

  /** A fake processor that records when each run started/ended and on which worker. */
  function recorder(workerId: string, runs: Run[], durationMs: number | ((claim: ClaimedWork) => number)) {
    return async (claim: ClaimedWork, lease: LeaseGuard) => {
      const start = since();
      lease.assertValid();
      await tick(typeof durationMs === "function" ? durationMs(claim) : durationMs);
      lease.assertValid();
      runs.push({ organizationId: claim.organizationId, workerId, kind: claim.kind, start, end: since() });
      return { failures: 0 };
    };
  }

  function overlapsPerOrganization(runs: Run[]): Run[][] {
    const conflicts: Run[][] = [];
    const byOrg = new Map<string, Run[]>();
    for (const run of runs) byOrg.set(run.organizationId, [...(byOrg.get(run.organizationId) ?? []), run]);
    for (const list of byOrg.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i += 1) if (list[i]!.start < list[i - 1]!.end) conflicts.push([list[i - 1]!, list[i]!]);
    }
    return conflicts;
  }

  it("three workers split 12 organizations: nobody processes one twice at once, each stays at its concurrency, all of them work", async () => {
    await makeOrgs(12);
    const runs: Run[] = [];
    let concurrent = 0;
    let peakTotal = 0;
    const perWorkerRunning: Record<string, number> = {};
    const perWorkerPeak: Record<string, number> = {};
    const worker = (id: string) => async (claim: ClaimedWork, lease: LeaseGuard) => {
      perWorkerRunning[id] = (perWorkerRunning[id] ?? 0) + 1;
      perWorkerPeak[id] = Math.max(perWorkerPeak[id] ?? 0, perWorkerRunning[id]!);
      concurrent += 1;
      peakTotal = Math.max(peakTotal, concurrent);
      try {
        return await recorder(id, runs, 120)(claim, lease);
      } finally {
        concurrent -= 1;
        perWorkerRunning[id]! -= 1;
      }
    };
    for (const id of ["w1", "w2", "w3"]) startWorker(id, worker(id));

    await vi.waitFor(() => expect(new Set(runs.map((r) => r.organizationId)).size).toBe(12), { timeout: 10_000 });
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(24), { timeout: 10_000 }); // a second round happened

    expect(overlapsPerOrganization(runs)).toEqual([]); // no organization ever ran in two places at once
    for (const id of ["w1", "w2", "w3"]) expect(perWorkerPeak[id]).toBeLessThanOrEqual(3); // per-worker concurrency holds
    expect(peakTotal).toBeGreaterThan(3); // workers really did run in parallel, beyond one worker's capacity
    expect(new Set(runs.map((r) => r.workerId)).size).toBe(3); // and each one contributed
  }, 20_000);

  it("active runs are start-to-start: a fast run waits the remainder, a slow run is followed immediately, never overlapping", async () => {
    const [org] = await makeOrgs(1);
    const runs: Run[] = [];
    const loop = startWorker(
      "w1",
      recorder("w1", runs, (claim) => (runs.length === 1 ? 900 : 100)), // 2nd run overruns the 400ms interval
    );
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(5), { timeout: 10_000 });
    await loop.stop(2000);

    const starts = runs.map((r) => r.start);
    expect(runs.every((r) => r.organizationId === org)).toBe(true);
    expect(overlapsPerOrganization(runs)).toEqual([]);
    // run 1 (100ms) -> next start ≈ +400 from start, not +500 (finish + interval)
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(380);
    expect(starts[1]! - starts[0]!).toBeLessThan(520);
    // run 2 overran (900ms > 400ms): run 3 starts right when run 2 ended, not 400ms after it
    expect(starts[2]! - runs[1]!.end).toBeLessThan(250);
    // and then it settles back to the 400ms cadence, with no burst of catch-up runs
    expect(starts[3]! - starts[2]!).toBeGreaterThanOrEqual(380);
  }, 20_000);

  it("reconciliation falling due during an active run is executed right after it, and is not skipped or reset", async () => {
    const [org] = await makeOrgs(1);
    const runs: Run[] = [];
    let dueInjected = false;
    const loop = startWorker("w1", async (claim, lease) => {
      if (claim.kind === "active" && !dueInjected) {
        dueInjected = true;
        // Mid-run: reconciliation comes due.
        await prisma.$executeRaw`UPDATE "organization_work_states" SET "reconciliationNextDueAt" = now() WHERE "organizationId" = ${org!}`;
      }
      return recorder("w1", runs, 250)(claim, lease);
    });
    await vi.waitFor(() => expect(runs.some((r) => r.kind === "reconciliation")).toBe(true), { timeout: 10_000 });
    await loop.stop(2000);

    const firstRecon = runs.findIndex((r) => r.kind === "reconciliation");
    expect(firstRecon).toBe(1); // the very next run after the active one that was in progress
    expect(runs[firstRecon]!.start - runs[0]!.end).toBeLessThan(250);
    expect(overlapsPerOrganization(runs)).toEqual([]);
  }, 20_000);

  it("an overdue reconciliation (worker restart after downtime) is claimed immediately, and re-armed within the 30-minute bound", async () => {
    const [org] = await makeOrgs(1);
    await prisma.$executeRaw`UPDATE "organization_work_states" SET "reconciliationNextDueAt" = now() - interval '3 hours', "activeNextDueAt" = now() + interval '1 hour' WHERE "organizationId" = ${org!}`;
    const runs: Run[] = [];
    const loop = startWorker("w1", recorder("w1", runs, 50));
    await vi.waitFor(() => expect(runs.length).toBe(1), { timeout: 5000 });
    await loop.stop(2000);

    expect(runs[0]).toMatchObject({ organizationId: org, kind: "reconciliation" });
    expect(runs[0]!.start).toBeLessThan(1500);
    const state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: org! } });
    const nextIn = state.reconciliationNextDueAt.getTime() - Date.now();
    // One interval after the run started, less the safety margin: strictly inside the 30-minute ceiling.
    expect(nextIn).toBeGreaterThan(28 * 60_000);
    expect(nextIn).toBeLessThan(30 * 60_000);
  }, 20_000);

  it("a crashed worker's organizations are recovered by another worker once the lease expires", async () => {
    const [org] = await makeOrgs(1);
    // "Crashed": claims the organization, then neither renews, finishes nor releases anything.
    const deadStore: WorkStore = {
      ...createDbWorkStore(prisma, "dead-worker"),
      renew: () => new Promise<boolean>(() => undefined),
      complete: () => new Promise<boolean>(() => undefined),
      release: () => new Promise<boolean>(() => undefined),
    };
    startWorker("dead-worker", () => new Promise(() => undefined), { leaseTtlMs: 600, capacity: 1 }, deadStore);
    await vi.waitFor(async () => {
      const state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: org! } });
      expect(state.leaseOwner).toBe("dead-worker");
    }, { timeout: 5000 });
    const dead = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: org! } });

    const runs: Run[] = [];
    const takeoverStartedAt = Date.now();
    const survivor = startWorker("survivor", recorder("survivor", runs, 50), { leaseTtlMs: 600 });
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 });
    const recoveryMs = Date.now() - takeoverStartedAt;

    expect(runs[0]!.workerId).toBe("survivor");
    expect(recoveryMs).toBeGreaterThan(100); // had to wait for the lease to lapse...
    expect(recoveryMs).toBeLessThan(3000); // ...but not much longer than the TTL
    expect(survivor.stats().recoveredLeases).toBe(1);
    const after = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: org! } });
    expect(after.leaseToken).toBeGreaterThan(dead.leaseToken);
    expect(after.consecutiveFailures).toBe(0); // the clean run after recovery resets the abandonment
  }, 20_000);

  it("a worker that lost its lease mid-run (paused, then resumed) cannot publish or record: it is fenced out", async () => {
    const [org] = await makeOrgs(1);
    const published: string[] = [];
    let staleOutcome: unknown = "not reached";

    // w-slow claims, then stalls past its lease (simulated partition: its renewals never reach the database).
    const slow = startWorker(
      "w-slow",
      async (_claim, lease) => {
        await tick(1500); // stalls; the lease (TTL 500ms) lapses and w-fast takes over
        try {
          await lease.assertHeld(); // the check before an irreversible step
          published.push("w-slow published"); // must never be reached
        } catch (error) {
          staleOutcome = error;
          throw error;
        }
        return { failures: 0 };
      },
      { leaseTtlMs: 500, capacity: 1 },
      { ...createDbWorkStore(prisma, "w-slow"), renew: () => new Promise<boolean>(() => undefined) },
    );

    await vi.waitFor(async () => {
      const state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: org! } });
      expect(state.leaseOwner).toBe("w-slow");
    }, { timeout: 5000 });

    const runs: Run[] = [];
    startWorker("w-fast", recorder("w-fast", runs, 30), { leaseTtlMs: 5_000, capacity: 1 });
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 });
    await vi.waitFor(() => expect(staleOutcome).toBeInstanceOf(LeaseLostError), { timeout: 10_000 });

    expect(published).toEqual([]);
    expect(slow.stats().completed).toBe(0); // and it recorded no result either
    expect(slow.stats().leaseLost).toBe(1);
    const state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: org! } });
    expect(state.leaseOwner === "w-slow").toBe(false);
  }, 30_000);

  it("graceful shutdown past the grace period releases the lease so another worker takes over immediately, not after the TTL", async () => {
    const [org] = await makeOrgs(1);
    const first = startWorker("w1", () => new Promise(() => undefined), { leaseTtlMs: 60_000, capacity: 1 });
    await vi.waitFor(() => expect(first.stats().running).toBe(1), { timeout: 5000 });

    const stopped = await first.stop(50);
    expect(stopped.abandoned).toBe(1);
    const state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: org! } });
    expect(state.leaseOwner).toBeNull(); // released, although its 60s TTL is nowhere near up

    const runs: Run[] = [];
    startWorker("w2", recorder("w2", runs, 20), { capacity: 1 });
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });
    expect(runs[0]!.workerId).toBe("w2");
  }, 20_000);

  it("a worker shut down within the grace period finishes and records its runs instead of dropping them", async () => {
    const [org] = await makeOrgs(1);
    const runs: Run[] = [];
    const loop = startWorker("w1", recorder("w1", runs, 300), { capacity: 1 });
    await vi.waitFor(() => expect(loop.stats().running).toBe(1), { timeout: 5000 });
    const result = await loop.stop(5_000);
    expect(result.abandoned).toBe(0);
    expect(runs).toHaveLength(1);
    const state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: org! } });
    expect(state.leaseOwner).toBeNull();
    expect(state.lastFinishedAt).not.toBeNull();
    expect(state.activeNextDueAt.getTime()).toBeGreaterThan(state.lastStartedAt!.getTime());
  }, 20_000);

  it("creates work-state rows for organizations added while workers are running", async () => {
    await makeOrgs(1);
    const runs: Run[] = [];
    startWorker("w1", recorder("w1", runs, 10), { ensureEveryMs: 100 });
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });
    const late = await prisma.organization.create({ data: { name: "Late Org" } });
    await vi.waitFor(() => expect(runs.some((r) => r.organizationId === late.id)).toBe(true), { timeout: 5000 });
  }, 20_000);
});
