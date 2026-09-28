/**
 * `withOrganizationSlaLock` (roadmap step 0.7, E-3): normalization and the
 * commitment/cycle/evaluation/notification pipeline tail for one
 * organization must never run concurrently from two call sites — the
 * worker's own cycle, a webhook delivery, and the onboarding source-sync
 * backfill routes all write the same Case/NormalizedEvent/Commitment rows.
 *
 * Real Postgres, like source-sync-evaluation.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import type { LiveDataEvent, PrismaClient } from "@sla/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("withOrganizationSlaLock (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");

  let organizationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    // @sla/db builds its connection from DATABASE_URL at import time.
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

    organizationId = (await prisma.organization.create({ data: { name: "Lock Org" } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("serializes two concurrent runs for the same organization — no interleaving", async () => {
    // A classic critical-section race: increment-with-delay-then-write. Two
    // callers running without mutual exclusion would both read `0`, both
    // compute `1`, and the second write would clobber the first — this is
    // exactly the shape of the "no unique key, concurrent runs duplicate"
    // race the lock exists to prevent (E-3). Held serially, the final value
    // must be `2`.
    let counter = 0;
    const observedStarts: number[] = [];

    const criticalSection = async (): Promise<void> => {
      await db.withOrganizationSlaLock(prisma, organizationId, async () => {
        observedStarts.push(counter);
        const current = counter;
        await new Promise((resolve) => setTimeout(resolve, 50));
        counter = current + 1;
      });
    };

    await Promise.all([criticalSection(), criticalSection()]);

    expect(counter).toBe(2);
    // The second caller must have observed the first caller's completed
    // write (1), never the stale value (0) a race would produce.
    expect(observedStarts.sort()).toEqual([0, 1]);
  });

  it("does not serialize two different organizations against each other", async () => {
    const otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Lock Org" } })).id;

    const startedAt: Record<string, number> = {};
    const start = Date.now();

    const hold = async (orgId: string, key: string): Promise<void> => {
      await db.withOrganizationSlaLock(prisma, orgId, async () => {
        startedAt[key] = Date.now() - start;
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
    };

    await Promise.all([hold(organizationId, "a"), hold(otherOrganizationId, "b")]);

    // Both should start almost immediately — a different organization's lock
    // never makes this one wait.
    expect(startedAt.a).toBeLessThan(50);
    expect(startedAt.b).toBeLessThan(50);
  });

  it("does not deadlock a small connection pool: more concurrent callers than pool connections still all complete", async () => {
    // Reproduces the 2026-09-19 incident: a burst of Zendesk webhook
    // deliveries for one organization exhausted the connection pool with
    // callers merely *waiting* for this lock, leaving the eventual winner
    // with no connection left to run `work()` on — a self-inflicted
    // deadlock that surfaced upstream as a 504. The lock itself must never
    // be held on a connection from the same pool `work()` uses (see
    // organization-lock.ts), so this must complete even with a pool smaller
    // than the number of concurrent callers.
    // `db.PrismaClient` (from the already-dynamically-imported `db`), not a
    // static top-level import: a static `import { PrismaClient } from
    // "@sla/db"` would resolve/evaluate that module (and its
    // `DATABASE_URL`-dependent adapter) before `beforeAll` overrides
    // `DATABASE_URL` to the test database.
    const smallPoolPrisma = new db.PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL!, max: 2 }),
    });
    try {
      const CONCURRENT_CALLERS = 6;
      const completions: number[] = [];

      const call = (n: number) =>
        db.withOrganizationSlaLock(smallPoolPrisma, organizationId, async () => {
          // Real work on the small-pool client — the failure mode was
          // exactly this query never getting a connection.
          await smallPoolPrisma.organization.findUnique({ where: { id: organizationId } });
          completions.push(n);
        });

      await Promise.all(Array.from({ length: CONCURRENT_CALLERS }, (_, n) => call(n)));

      expect(completions).toHaveLength(CONCURRENT_CALLERS);
    } finally {
      await smallPoolPrisma.$disconnect();
    }
  }, 20_000);

  describe("live-data NOTIFY", () => {
    // A dedicated LISTEN connection per test, mirroring how `subscribeToLiveData`
    // itself listens — proves the notification is real Postgres pub/sub, not
    // an in-memory shortcut, and that it only reaches listeners on commit.
    let listener: pg.Client;
    let received: LiveDataEvent[];

    beforeEach(async () => {
      listener = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await listener.connect();
      received = [];
      listener.on("notification", (message: pg.Notification) => {
        if (message.channel !== db.LIVE_DATA_CHANNEL || !message.payload) return;
        received.push(JSON.parse(message.payload) as LiveDataEvent);
      });
      await listener.query(`LISTEN ${db.LIVE_DATA_CHANNEL}`);
    });

    afterEach(async () => {
      // Otherwise a stale connection from an earlier test — still LISTENing,
      // never closed — would keep receiving later tests' notifications too:
      // its handler closure shares this block's `received` binding.
      await listener?.end();
    });

    it("notifies listeners once work() commits", async () => {
      await db.withOrganizationSlaLock(prisma, organizationId, async () => {
        // no-op work — the point is that the lock's own commit still fires.
      });

      // NOTIFY delivery is async relative to COMMIT; give it a beat to arrive.
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(received).toEqual([{ type: "data.updated", organizationId }]);
    });

    it("does not notify when work() throws and the transaction rolls back", async () => {
      await expect(
        db.withOrganizationSlaLock(prisma, organizationId, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(received).toEqual([]);
    });

    it("scopes the event to the organization that actually changed", async () => {
      const otherOrganizationId = (await prisma.organization.create({ data: { name: "Notify Other Org" } })).id;

      await db.withOrganizationSlaLock(prisma, otherOrganizationId, async () => {});
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(received).toEqual([
        { type: "data.updated", organizationId: otherOrganizationId },
      ]);
      expect(received[0]!.organizationId).not.toBe(organizationId);
    });
  });
});
