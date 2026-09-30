/**
 * Organization work state + leases (multi-worker scheduling) against real
 * Postgres: atomic claiming under `FOR UPDATE SKIP LOCKED`, lease expiry and
 * recovery, fencing tokens, start-to-start due times.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test";
 * skipped when unset. Truncates every table between tests.
 */
import type { PrismaClient } from "../src/index";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("organization work state (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("../src/index");

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("../src/index");
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

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const RECON_MS = 30 * 60_000;

  async function makeOrgs(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) ids.push((await prisma.organization.create({ data: { name: `Org ${i}` } })).id);
    await db.ensureOrganizationWorkStates(prisma, { reconciliationIntervalMs: RECON_MS });
    // Every test starts from "active due now, reconciliation not due" unless it says otherwise.
    await prisma.$executeRaw`UPDATE "organization_work_states" SET "reconciliationNextDueAt" = now() + interval '20 minutes'`;
    return ids;
  }

  const setDue = (organizationId: string, active: string, reconciliation: string) =>
    prisma.$executeRawUnsafe(
      `UPDATE "organization_work_states" SET "activeNextDueAt" = now() + interval '${active}', "reconciliationNextDueAt" = now() + interval '${reconciliation}' WHERE "organizationId" = $1`,
      organizationId,
    );

  const expireLease = (organizationId: string) =>
    prisma.$executeRaw`UPDATE "organization_work_states" SET "leaseExpiresAt" = now() - interval '1 second' WHERE "organizationId" = ${organizationId}`;

  const row = (organizationId: string) => prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId } });

  describe("ensureOrganizationWorkStates", () => {
    it("creates one row per organization, idempotently, with reconciliation due within one interval", async () => {
      await Promise.all(Array.from({ length: 5 }, (_, i) => prisma.organization.create({ data: { name: `O${i}` } })));
      expect(await db.ensureOrganizationWorkStates(prisma, { reconciliationIntervalMs: RECON_MS })).toBe(5);
      expect(await db.ensureOrganizationWorkStates(prisma, { reconciliationIntervalMs: RECON_MS })).toBe(0);

      const states = await prisma.organizationWorkState.findMany();
      expect(states).toHaveLength(5);
      const now = Date.now();
      for (const state of states) {
        expect(state.activeNextDueAt.getTime()).toBeLessThanOrEqual(now + 1000);
        // The 30-minute bound holds from creation: never scheduled past one interval out (less the safety margin).
        expect(state.reconciliationNextDueAt.getTime()).toBeLessThanOrEqual(now + RECON_MS - db.reconciliationSafetyMarginMs(RECON_MS) + 1000);
        expect(state.leaseOwner).toBeNull();
        expect(state.leaseToken).toBe(0n);
      }
    });
  });

  describe("claimDueOrganizations", () => {
    it("claims only due work", async () => {
      const [due, notDue] = await makeOrgs(2);
      await setDue(notDue!, "5 minutes", "20 minutes");

      const claims = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 10 });
      expect(claims.map((c) => c.organizationId)).toEqual([due]);
      expect(claims[0]).toMatchObject({ kind: "active", leaseOwner: "w1", leaseToken: 1n, recoveredFromOwner: null });
    });

    it("picks reconciliation when it is due, and active otherwise", async () => {
      const [a, b] = await makeOrgs(2);
      await setDue(a!, "-1 second", "-1 second");
      await setDue(b!, "-1 second", "10 minutes");
      const claims = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 10 });
      const kinds = Object.fromEntries(claims.map((c) => [c.organizationId, c.kind]));
      expect(kinds).toEqual({ [a!]: "reconciliation", [b!]: "active" });
    });

    it("respects the limit and claims oldest-due first", async () => {
      const ids = await makeOrgs(4);
      for (const [i, id] of ids.entries()) await setDue(id, `-${(ids.length - i) * 10} seconds`, "20 minutes");
      const claims = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 2 });
      expect(claims.map((c) => c.organizationId)).toEqual([ids[0], ids[1]]);
    });

    it("never hands the same organization to two claimers running concurrently", async () => {
      const ORGS = 60;
      await makeOrgs(ORGS);
      const claimers = Array.from({ length: 12 }, (_, i) =>
        db.claimDueOrganizations(prisma, { owner: `worker-${i}`, limit: 7 }),
      );
      const results = (await Promise.all(claimers)).flat();
      const ids = results.map((c) => c.organizationId);
      expect(new Set(ids).size).toBe(ids.length); // zero duplicate claims
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThanOrEqual(ORGS);
      // Keep claiming until drained: every organization is claimed exactly once overall.
      let drained = ids.length;
      const seen = new Set(ids);
      while (drained < ORGS) {
        const more = await db.claimDueOrganizations(prisma, { owner: "drain", limit: 25 });
        if (more.length === 0) break;
        for (const claim of more) {
          expect(seen.has(claim.organizationId)).toBe(false);
          seen.add(claim.organizationId);
        }
        drained += more.length;
      }
      expect(seen.size).toBe(ORGS);
    });

    it("does not claim an organization under a live lease, for either kind of work", async () => {
      const [org] = await makeOrgs(1);
      const [first] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      expect(first).toBeDefined();
      // Reconciliation comes due while active work is running: still not claimable by anyone else.
      await setDue(org!, "-1 second", "-1 second");
      expect(await db.claimDueOrganizations(prisma, { owner: "w2", limit: 5 })).toEqual([]);
      expect(await db.claimDueOrganizations(prisma, { owner: "w1", limit: 5 })).toEqual([]);
    });

    it("reclaims an expired lease with a higher fencing token and records the abandonment", async () => {
      const [org] = await makeOrgs(1);
      const [crashed] = await db.claimDueOrganizations(prisma, { owner: "crashed-worker", limit: 1, leaseTtlMs: 60_000 });
      await expireLease(org!);

      const [recovered] = await db.claimDueOrganizations(prisma, { owner: "w2", limit: 1 });
      expect(recovered).toMatchObject({ organizationId: org, leaseOwner: "w2", recoveredFromOwner: "crashed-worker" });
      expect(recovered!.leaseToken).toBeGreaterThan(crashed!.leaseToken);

      const state = await row(org!);
      expect(state.consecutiveFailures).toBe(1);
      expect(state.lastError).toMatch(/crashed-worker/);
    });

    it("recovers when the TTL simply elapses, with no manual expiry", async () => {
      await makeOrgs(1);
      await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1, leaseTtlMs: 150 });
      expect(await db.claimDueOrganizations(prisma, { owner: "w2", limit: 1 })).toHaveLength(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await db.claimDueOrganizations(prisma, { owner: "w2", limit: 1 })).toHaveLength(1);
    });
  });

  describe("reconciliationSafetyMarginMs", () => {
    it("is one minute for a 30-minute interval and 10% for short ones", () => {
      expect(db.reconciliationSafetyMarginMs(30 * 60_000)).toBe(60_000);
      expect(db.reconciliationSafetyMarginMs(45_000)).toBe(4_500);
      expect(db.reconciliationSafetyMarginMs(5 * 60_000)).toBe(30_000);
    });
  });

  describe("fencing", () => {
    it("a holder whose lease was re-claimed can no longer renew, verify, complete or release", async () => {
      const [org] = await makeOrgs(1);
      const [stale] = await db.claimDueOrganizations(prisma, { owner: "slow-worker", limit: 1 });
      await expireLease(org!);
      const [current] = await db.claimDueOrganizations(prisma, { owner: "fast-worker", limit: 1 });
      const before = await row(org!);

      expect(await db.isLeaseHeld(prisma, stale!)).toBe(false);
      expect(await db.renewLease(prisma, stale!)).toBe(false);
      const outcome = { failed: false, activeIntervalMs: 10_000, reconciliationIntervalMs: RECON_MS };
      expect(await db.completeWork(prisma, stale!, outcome)).toBe(false);
      expect(await db.releaseLease(prisma, stale!)).toBe(false);

      // Nothing the stale holder did changed the row.
      const after = await row(org!);
      expect(after).toEqual(before);
      expect(after.leaseOwner).toBe("fast-worker");

      expect(await db.isLeaseHeld(prisma, current!)).toBe(true);
      expect(await db.completeWork(prisma, current!, outcome)).toBe(true);
    });

    it("same owner, stale token is fenced too (a worker re-claiming its own org)", async () => {
      const [org] = await makeOrgs(1);
      const [first] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      await expireLease(org!);
      const [second] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      expect(second!.leaseToken).toBeGreaterThan(first!.leaseToken);
      expect(await db.renewLease(prisma, first!)).toBe(false);
      expect(await db.renewLease(prisma, second!)).toBe(true);
    });

    it("renewal extends the lease so it is not reclaimable", async () => {
      const [org] = await makeOrgs(1);
      const [claim] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1, leaseTtlMs: 400 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await db.renewLease(prisma, claim!)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 250)); // past the original expiry
      expect(await db.claimDueOrganizations(prisma, { owner: "w2", limit: 1 })).toHaveLength(0);
      expect((await row(org!)).leaseOwner).toBe("w1");
    });
  });

  describe("completeWork scheduling", () => {
    it("schedules the next active run start-to-start from the claim's start", async () => {
      const [org] = await makeOrgs(1);
      const [claim] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      await new Promise((resolve) => setTimeout(resolve, 100)); // the run takes a moment
      expect(await db.completeWork(prisma, claim!, { failed: false, activeIntervalMs: 10_000, reconciliationIntervalMs: RECON_MS })).toBe(true);

      const state = await row(org!);
      expect(state.activeNextDueAt.getTime()).toBe(claim!.startedAt.getTime() + 10_000);
      expect(state.leaseOwner).toBeNull();
      expect(state.leaseExpiresAt).toBeNull();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastFinishedAt!.getTime()).toBeGreaterThan(state.lastStartedAt!.getTime());
    });

    it("a run that overran its slot is due again immediately — once, not repeatedly", async () => {
      const [org] = await makeOrgs(1);
      const [claim] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      // Pretend the run took 17s of a 10s interval by moving its start into the past.
      await prisma.$executeRaw`UPDATE "organization_work_states" SET "lastStartedAt" = now() - interval '17 seconds' WHERE "organizationId" = ${org!}`;
      await db.completeWork(prisma, claim!, { failed: false, activeIntervalMs: 10_000, reconciliationIntervalMs: RECON_MS });

      const again = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 5 });
      expect(again).toHaveLength(1); // claimable right away
      expect(again[0]!.leaseToken).toBe(2n);
      // ...and it was a single pending run: nothing else is queued behind it.
      expect(await db.claimDueOrganizations(prisma, { owner: "w2", limit: 5 })).toHaveLength(0);
    });

    it("an active run never moves the reconciliation deadline; a reconciliation run re-arms both", async () => {
      const [org] = await makeOrgs(1);
      await setDue(org!, "-1 second", "7 minutes");
      const dueBefore = (await row(org!)).reconciliationNextDueAt;

      const [active] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      expect(active!.kind).toBe("active");
      await db.completeWork(prisma, active!, { failed: false, activeIntervalMs: 10_000, reconciliationIntervalMs: RECON_MS });
      expect((await row(org!)).reconciliationNextDueAt).toEqual(dueBefore);

      await setDue(org!, "-1 second", "-1 second");
      const [recon] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      expect(recon!.kind).toBe("reconciliation");
      await db.completeWork(prisma, recon!, { failed: false, activeIntervalMs: 10_000, reconciliationIntervalMs: RECON_MS });
      const state = await row(org!);
      expect(state.reconciliationNextDueAt.getTime()).toBe(recon!.startedAt.getTime() + RECON_MS - db.reconciliationSafetyMarginMs(RECON_MS));
      expect(state.activeNextDueAt.getTime()).toBe(recon!.startedAt.getTime() + 10_000);
      expect(state.lastReconciliationFinishedAt).not.toBeNull();
    });

    it("reconciliation that comes due during an active run is claimed as soon as it finishes — not skipped, not reset", async () => {
      const [org] = await makeOrgs(1);
      const [active] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      await setDue(org!, "-1 second", "-1 second"); // reconciliation falls due mid-run
      await db.completeWork(prisma, active!, { failed: false, activeIntervalMs: 10_000, reconciliationIntervalMs: RECON_MS });
      const [next] = await db.claimDueOrganizations(prisma, { owner: "w2", limit: 1 });
      expect(next).toMatchObject({ organizationId: org, kind: "reconciliation" });
    });

    it("counts failures and clears them on a clean run", async () => {
      const [org] = await makeOrgs(1);
      const outcome = { activeIntervalMs: 10, reconciliationIntervalMs: RECON_MS };
      for (let i = 1; i <= 2; i += 1) {
        await setDue(org!, "-1 second", "20 minutes");
        const [claim] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
        await db.completeWork(prisma, claim!, { ...outcome, failed: true, error: `boom ${i}` });
        expect(await row(org!)).toMatchObject({ consecutiveFailures: i, lastError: `boom ${i}` });
      }
      await setDue(org!, "-1 second", "20 minutes");
      const [claim] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      await db.completeWork(prisma, claim!, { ...outcome, failed: false });
      expect(await row(org!)).toMatchObject({ consecutiveFailures: 0, lastError: null });
    });
  });

  describe("releaseLease", () => {
    it("frees the organization without touching its schedule, so another worker takes it at once", async () => {
      const [org] = await makeOrgs(1);
      const [claim] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      const dueBefore = (await row(org!)).activeNextDueAt;
      expect(await db.releaseLease(prisma, claim!)).toBe(true);
      expect((await row(org!)).activeNextDueAt).toEqual(dueBefore);
      const [taken] = await db.claimDueOrganizations(prisma, { owner: "w2", limit: 1 });
      expect(taken).toMatchObject({ organizationId: org, leaseOwner: "w2", recoveredFromOwner: null });
    });
  });

  describe("tenant isolation", () => {
    it("a lease on one organization grants nothing on another", async () => {
      const [a, b] = await makeOrgs(2);
      const claims = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      const mine = claims[0]!;
      const theirs = mine.organizationId === a ? b! : a!;
      const forged = { ...mine, organizationId: theirs };
      expect(await db.renewLease(prisma, forged)).toBe(false);
      expect(await db.completeWork(prisma, forged, { failed: false, activeIntervalMs: 10, reconciliationIntervalMs: RECON_MS })).toBe(false);
      expect((await row(theirs)).leaseOwner).toBeNull();
    });
  });

  describe("observability queries", () => {
    it("msUntilNextClaimable is 0 when work is due, the remaining wait otherwise, null with no rows", async () => {
      expect(await db.msUntilNextClaimable(prisma)).toBeNull();
      const [org] = await makeOrgs(1);
      expect(await db.msUntilNextClaimable(prisma)).toBe(0);
      await setDue(org!, "5 seconds", "20 minutes");
      const wait = await db.msUntilNextClaimable(prisma);
      expect(wait).toBeGreaterThan(3500);
      expect(wait).toBeLessThanOrEqual(5000);
    });

    it("summarizes leases, lag and failures", async () => {
      const [a, b, c] = await makeOrgs(3);
      await setDue(a!, "-30 seconds", "20 minutes");
      await setDue(b!, "-5 seconds", "-90 seconds");
      await setDue(c!, "1 minute", "20 minutes");
      const [claim] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      expect(claim!.organizationId).toBe(b); // oldest-due by LEAST(): b's reconciliation is 90s overdue
      await prisma.$executeRaw`UPDATE "organization_work_states" SET "consecutiveFailures" = 2 WHERE "organizationId" = ${c!}`;

      const summary = await db.getWorkStateSummary(prisma);
      expect(summary).toMatchObject({ organizations: 3, leased: 1, expiredLeases: 0, failing: 1, overdueActive: 2, overdueReconciliation: 1 });
      expect(summary.maxActiveLagMs).toBeGreaterThanOrEqual(29_000);
      expect(summary.maxReconciliationLagMs).toBeGreaterThanOrEqual(89_000);
      await expireLease(b!);
      expect((await db.getWorkStateSummary(prisma)).expiredLeases).toBe(1);
    });

    it("getWorkStateNextRuns: earliest future due time per kind, never in the past, ignoring organizations mid-run", async () => {
      expect(await db.getWorkStateNextRuns(prisma)).toEqual({ nextActivePollAt: null, nextReconciliationAt: null });
      const [a, b, c] = await makeOrgs(3);
      await setDue(a!, "30 seconds", "25 minutes");
      await setDue(b!, "10 seconds", "15 minutes");
      await setDue(c!, "60 seconds", "20 minutes");
      const next = await db.getWorkStateNextRuns(prisma);
      expect(next.nextActivePollAt!.getTime() - Date.now()).toBeGreaterThan(8_000);
      expect(next.nextActivePollAt!.getTime() - Date.now()).toBeLessThanOrEqual(10_500);
      expect(next.nextReconciliationAt!.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 500);

      // c is overdue and unleased: it runs as soon as a slot frees -> "now", not a moment in the past.
      await setDue(c!, "-40 seconds", "20 minutes");
      const overdue = await db.getWorkStateNextRuns(prisma);
      expect(overdue.nextActivePollAt!.getTime()).toBeGreaterThanOrEqual(Date.now() - 1_000);
      expect(overdue.nextActivePollAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);

      // Once c is being processed (live lease), its stale due time no longer counts: b's is the next one.
      await prisma.$executeRaw`UPDATE "organization_work_states" SET "leaseOwner" = 'w1', "leaseExpiresAt" = now() + interval '1 minute' WHERE "organizationId" = ${c!}`;
      const leased = await db.getWorkStateNextRuns(prisma);
      expect(leased.nextActivePollAt!.getTime() - Date.now()).toBeGreaterThan(8_000);
    });
  });

  describe("recordOrganizationRunOutcome (singleton compat fields)", () => {
    const settings = () => prisma.workerSettings.findUniqueOrThrow({ where: { id: "singleton" } });

    it("moves the last-run timestamps forward only, counts failing organizations, and treats reconciliation as an active run too", async () => {
      const [failing] = await makeOrgs(2); // the other organization stays healthy
      await prisma.$executeRaw`UPDATE "organization_work_states" SET "consecutiveFailures" = 3 WHERE "organizationId" = ${failing!}`;

      const t1 = new Date("2026-01-01T12:00:10Z");
      const t0 = new Date("2026-01-01T12:00:00Z");
      await db.recordOrganizationRunOutcome(prisma, "active", t1);
      await db.recordOrganizationRunOutcome(prisma, "active", t0); // finishes out of order: must not move the timestamp back
      let row = await settings();
      expect(row.lastActivePollAt).toEqual(t1);
      expect(row.lastActivePollFailures).toBe(1);
      expect(row.lastReconciliationAt).toBeNull();
      expect(row.lastHeartbeatAt).not.toBeNull();

      const t2 = new Date("2026-01-01T12:05:00Z");
      await db.recordOrganizationRunOutcome(prisma, "reconciliation", t2);
      row = await settings();
      expect(row.lastReconciliationAt).toEqual(t2);
      expect(row.lastActivePollAt).toEqual(t2);
      expect(row.lastReconciliationFailures).toBe(1);
    });

    it("an active run refreshes the reconciliation failure count too, so a fixed failure clears Degraded without waiting for the next reconciliation", async () => {
      const [failing] = await makeOrgs(1);
      await prisma.$executeRaw`UPDATE "organization_work_states" SET "consecutiveFailures" = 3 WHERE "organizationId" = ${failing!}`;
      await db.recordOrganizationRunOutcome(prisma, "reconciliation", new Date("2026-01-01T12:00:00Z"));
      expect((await settings()).lastReconciliationFailures).toBe(1);

      await prisma.$executeRaw`UPDATE "organization_work_states" SET "consecutiveFailures" = 0`;
      await db.recordOrganizationRunOutcome(prisma, "active", new Date("2026-01-01T12:00:10Z"));
      const row = await settings();
      expect(row.lastActivePollFailures).toBe(0);
      expect(row.lastReconciliationFailures).toBe(0);
      expect(db.deriveWorkerStatus(row, new Date())).not.toBe("degraded");
    });
  });

  describe("migration backfill", () => {
    it("the migration's INSERT carries each organization's schedule over from worker_settings (overdue stays overdue, recent stays recent, >30min capped)", async () => {
      const [overdue] = await makeOrgs(1);
      await prisma.organizationWorkState.deleteMany();
      // Re-run the migration's backfill statement verbatim against a worker_settings row from the old world.
      const sql = (await import("node:fs")).readFileSync(
        new URL("../prisma/migrations/20260930170000_organization_work_state/migration.sql", import.meta.url),
        "utf8",
      );
      const backfill = sql.slice(sql.indexOf('INSERT INTO "organization_work_states"'));

      await prisma.workerSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", activePollIntervalMs: 10_000, reconciliationIntervalMs: 24 * 3_600_000, lastReconciliationAt: new Date(Date.now() - 3 * 3_600_000) },
        update: { reconciliationIntervalMs: 24 * 3_600_000, lastReconciliationAt: new Date(Date.now() - 3 * 3_600_000) },
      });
      await prisma.$executeRawUnsafe(backfill);
      let state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: overdue! } });
      expect(state.reconciliationNextDueAt.getTime()).toBeLessThan(Date.now()); // last pass 3h ago + min(24h, 30min) = overdue

      await prisma.organizationWorkState.deleteMany();
      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
      await prisma.workerSettings.update({ where: { id: "singleton" }, data: { lastReconciliationAt: tenMinutesAgo } });
      await prisma.$executeRawUnsafe(backfill);
      state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: overdue! } });
      const expected = tenMinutesAgo.getTime() + 30 * 60_000 - 60_000; // capped interval (not the stored 24h) less the 60s margin
      expect(Math.abs(state.reconciliationNextDueAt.getTime() - expected)).toBeLessThan(2000);

      await prisma.organizationWorkState.deleteMany();
      await prisma.workerSettings.deleteMany(); // a fresh install: never reconciled -> due now
      await prisma.$executeRawUnsafe(backfill);
      state = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: overdue! } });
      expect(state.reconciliationNextDueAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  describe("deleting an organization", () => {
    it("removes its work state, and completing afterwards is a harmless no-op", async () => {
      const [org] = await makeOrgs(1);
      const [claim] = await db.claimDueOrganizations(prisma, { owner: "w1", limit: 1 });
      await prisma.organization.delete({ where: { id: org! } });
      expect(await prisma.organizationWorkState.count()).toBe(0);
      expect(await db.completeWork(prisma, claim!, { failed: false, activeIntervalMs: 10, reconciliationIntervalMs: RECON_MS })).toBe(false);
    });
  });
});
