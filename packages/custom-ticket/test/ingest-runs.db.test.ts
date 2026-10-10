/**
 * D-08: ingest run behaviour that needs a real database, against a local fixture
 * helpdesk: resume after a crash (page-atomic commits), the per-run page cap
 * (`partial`, then resumed), zero-progress runs (U5), and the ingest-level rows
 * of the §6.12 table (A, B, D, E; C is a normalization guard, covered in
 * guards.test.ts and the worker's sync-runs tests).
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"
 * (every test truncates all tables). Skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { RunBudget, SafeHttpError } from "@sla/safe-http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NormalizationAbortedError, projectCanonicalBatch } from "@sla/ingestion";
import { fixtureConfig, startFixture, ticket, type Fixture, type Handler } from "./ingest-fixtures";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Custom REST ingest runs (real Postgres, fixture helpdesk)", () => {
  let prisma: PrismaClient;
  let lib: typeof import("../src/index");
  let organizationId: string;
  let integrationId: string;
  let fixture: Fixture | undefined;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    for (const key of ["DATABASE_URL", "CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS", "INTEGRATION_TOKEN_ENCRYPTION_KEY"]) saved[key] = process.env[key];
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS = "1";
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-key-material-for-ingest-runs-0001";
    prisma = (await import("@sla/db")).getPrismaClient();
    lib = await import("../src/index");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture?.close();
    fixture = undefined;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma?.$disconnect();
  });

  async function setup(tickets: unknown[], pageSize: number, options: { incremental?: boolean; handler?: Handler; verifyDeletions?: boolean } = {}) {
    fixture = await startFixture(tickets, pageSize, options.handler);
    const raw = fixtureConfig(fixture.baseUrl, pageSize, { incremental: options.incremental });
    if (options.verifyDeletions) {
      raw.deletion = { verifyWithDetail: true };
      raw.ticketDetail = { request: { method: "GET", path: "/v2/tickets/{{ticket.id}}" } };
    }
    const parsed = lib.parseConfig(raw);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    organizationId = (await prisma.organization.create({ data: { name: "Custom" } })).id;
    const integration = await prisma.integration.create({ data: { organizationId, provider: "custom", status: "connected", credentials: {}, activeConfigVersion: 1 } });
    integrationId = integration.id;
    const { encryptCustomSecrets } = await import("@sla/db");
    await prisma.integration.update({
      where: { id: integrationId },
      data: { credentials: { secrets: encryptCustomSecrets({ token: "fixture-token" }, { organizationId, integrationId }), reauthRequired: false } },
    });
    await prisma.customProviderConfigVersion.create({
      data: { organizationId, integrationId, version: 1, schemaVersion: 1, config: parsed.config as never, configHash: "h", validatedAt: new Date() },
    });
    await prisma.integrationBetaAllowlist.create({ data: { provider: "custom", organizationId, addedByEmail: "ops@elapsed.test" } });
  }

  const run = (client: PrismaClient = prisma) =>
    lib.runCustomIngest({
      prisma: client,
      integration: { id: integrationId, organizationId, provider: "custom", status: "connected" },
      logger: { info() {}, warn() {}, error() {}, child() { return this; } },
      appUrl: null,
      loadOAuthConfig: async () => null,
    } as never);

  const cursor = async () => (await prisma.integration.findUniqueOrThrow({ where: { id: integrationId }, select: { cursor: true } })).cursor as Record<string, any>;
  const rawIds = async () => (await prisma.rawEvent.findMany({ where: { integrationId }, select: { providerEventId: true } })).map((r) => r.providerEventId).sort();
  const tickets = (n: number) => Array.from({ length: n }, (_, i) => ticket(i));

  it("resumes after a crash between a page's fetch and its commit: no loss, no duplicates, the same window anchor", async () => {
    await setup(tickets(7), 2); // 4 pages
    // Crash model: the process dies before the third page's transaction commits.
    let commits = 0;
    const crashing = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return (...args: unknown[]) => {
            commits += 1;
            if (commits === 3) throw new Error("simulated crash before commit");
            return (target.$transaction as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(run(crashing as PrismaClient)).rejects.toThrow("simulated crash before commit");

    const afterCrash = await cursor();
    expect(afterCrash.listing).toMatchObject({ pages: 2, tickets: 4 });
    expect(await rawIds()).toHaveLength(4); // pages 1 and 2 only; page 3 wrote nothing
    expect(afterCrash.backfillCompletedAt).toBeUndefined();
    const anchor = afterCrash.listing.anchor;
    const requestsBefore = fixture!.requested.length;

    const result = await run();
    expect(result.partial).toBeUndefined();
    expect(fixture!.requested.slice(requestsBefore)).toEqual(["4", "6"]); // continues at page 3, never re-reads pages 1-2
    expect(await rawIds()).toHaveLength(7);
    const done = await cursor();
    expect(done.listing).toBeNull();
    expect(done.backfillCompletedAt).toBeTruthy();
    expect(anchor).toBeTruthy();

    // A further full pass changes nothing: raw events are unique on (integration, event id).
    await run();
    expect(await rawIds()).toHaveLength(7);
  });

  it("keeps the same window anchor and does not move the watermark until the pass completes", async () => {
    await setup(tickets(5), 2, { incremental: true });
    let commits = 0;
    const crashing = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return (...args: unknown[]) => {
            commits += 1;
            if (commits === 2) throw new Error("simulated crash before commit");
            return (target.$transaction as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(run(crashing as PrismaClient)).rejects.toThrow("simulated crash");
    const mid = await cursor();
    expect(mid.watermark).toBeUndefined();
    await run();
    const done = await cursor();
    expect(done.watermark).toBeTruthy();
    // lookback 300 s: the watermark is the anchor minus the lookback, so the anchor survived the crash.
    expect(Date.parse(mid.listing.anchor) - Date.parse(done.watermark)).toBe(300_000);
  });

  it("§6.12 B/E: the page cap ends a run `partial` at the last completed page, with failed tickets reported, then the next run finishes", async () => {
    const cap = lib.MAX_PAGES_PER_RUN;
    const all = tickets(cap + 2);
    all[3] = ticket(3, { id: null }); // a record failure inside a completed page
    await setup(all, 1);
    const first = await run();
    expect(first.partial).toMatchObject({ reason: "run_cap_reached", progress: { pagesCompleted: cap, initialImportRunning: true } });
    expect(first.syncRun?.recordFailureCount).toBe(1);
    expect(first.syncRun?.recordFailures[0]).toMatchObject({ code: expect.any(String) });
    const mid = await cursor();
    expect(mid.listing).toMatchObject({ pages: cap });
    expect(mid.backfillCompletedAt).toBeUndefined();
    expect(mid.zeroProgressRuns).toBe(0);

    const second = await run();
    expect(second.partial).toBeUndefined();
    expect((await cursor()).backfillCompletedAt).toBeTruthy();
    expect(await rawIds()).toHaveLength(cap + 1); // every good ticket once; the failed one never stored
  }, 90_000);

  it("§6.12 A: a completed pass with a record failure is a normal run that reports the failed ticket", async () => {
    const all = tickets(4);
    all[1] = ticket(1, { id: null });
    await setup(all, 2);
    const result = await run();
    expect(result.partial).toBeUndefined();
    expect(result.syncRun).toMatchObject({ recordFailureCount: 1 });
    expect(result.counts).toMatchObject({ tickets: 4, pages: 2 });
    expect(await rawIds()).toHaveLength(3);
    expect((await cursor()).backfillCompletedAt).toBeTruthy();
  });

  it("§6.12 D: a provider failure after completed pages is a failed run; the pages are kept and the next run resumes after them", async () => {
    let failing = true;
    await setup(tickets(6), 2, {
      handler: (cursor, _req, res) => {
        if (failing && cursor === "4") {
          res.writeHead(400).end("{}"); // not retryable: fails at once with a fixed code
          return true;
        }
      },
    });
    await expect(run()).rejects.toMatchObject({ name: "CustomIngestError", code: "status_400" });
    const mid = await cursor();
    expect(mid.listing).toMatchObject({ pages: 2, tickets: 4 });
    expect(mid.backfillCompletedAt).toBeUndefined();
    expect(await rawIds()).toHaveLength(4);
    failing = false;
    const requestsBefore = fixture!.requested.length;
    await run();
    expect(fixture!.requested.slice(requestsBefore)).toEqual(["4"]);
    expect(await rawIds()).toHaveLength(6);
  });

  describe("zero-progress runs (U5)", () => {
    // The real 120 s budget cannot be spent in a unit test, so budget exhaustion is
    // forced by making every attempt start throw the code the real budget throws.
    const exhaust = () =>
      vi.spyOn(RunBudget.prototype, "assertCanStart").mockImplementation(() => {
        throw new SafeHttpError("budget_exhausted");
      });

    it("counts zero-progress partial runs, and the run after the third is `failed` with `no_progress`", async () => {
      await setup(tickets(3), 2);
      exhaust();
      for (const expected of [1, 2, 3]) {
        const result = await run();
        expect(result.partial).toMatchObject({ reason: "budget_exhausted", progress: { pagesCompleted: 0 } });
        expect((await cursor()).zeroProgressRuns).toBe(expected);
      }
      await expect(run()).rejects.toMatchObject({ name: "CustomIngestError", code: "no_progress" });
      expect((await cursor()).zeroProgressRuns).toBe(0); // reset so a fixed source can recover
      expect(await rawIds()).toHaveLength(0);
      expect(fixture!.requested).toHaveLength(0); // never reached the provider
    });

    it("a run that completes a page resets the counter", async () => {
      await setup(tickets(3), 2);
      const spy = exhaust();
      await run();
      await run();
      expect((await cursor()).zeroProgressRuns).toBe(2);
      spy.mockRestore();
      await run();
      expect((await cursor()).zeroProgressRuns).toBe(0);
      expect(await rawIds()).toHaveLength(3);
    });
  });
  describe("normalization guards end to end (nothing is written on an abort)", () => {
    const integrationRef = () => ({ id: integrationId, organizationId, provider: "custom", status: "connected" });
    const normalize = () => lib.normalizeCustom({ prisma, integration: integrationRef(), mode: "full" } as never);
    const project = async () => projectCanonicalBatch(prisma, integrationRef() as never, await normalize());
    const counts = async () => ({
      cases: await prisma.case.count({ where: { sourceIntegrationId: integrationId } }),
      live: await prisma.case.count({ where: { sourceIntegrationId: integrationId, deletedAt: null } }),
      events: await prisma.normalizedEvent.count({ where: { case: { sourceIntegrationId: integrationId } } }),
    });
    const aborted = async () => {
      try {
        await normalize();
      } catch (error) {
        if (error instanceof NormalizationAbortedError) return error;
        throw error;
      }
      return null;
    };
    const withCeiling = async <T>(value: string, fn: () => Promise<T>): Promise<T> => {
      const before = process.env.CUSTOM_PROVIDER_LIVE_CASE_CEILING;
      process.env.CUSTOM_PROVIDER_LIVE_CASE_CEILING = value;
      try {
        return await fn();
      } finally {
        if (before === undefined) delete process.env.CUSTOM_PROVIDER_LIVE_CASE_CEILING;
        else process.env.CUSTOM_PROVIDER_LIVE_CASE_CEILING = before;
      }
    };
    const deletionMarker = (id: string) =>
      prisma.rawEvent.create({ data: { integrationId, providerEventId: `ticket_deleted:${id}:${"0".repeat(8)}`, sourceHash: "0".repeat(8), payload: { t: id } } });

    it("row 9: L + N = C is allowed, C + 1 aborts with `live_case_ceiling`, and the abort writes no case or event", async () => {
      await setup(tickets(5), 5);
      await run();
      await withCeiling("4", async () => {
        const error = await aborted();
        expect(error?.code).toBe("live_case_ceiling");
        expect(error?.details).toMatchObject({ L: 0, N: 5, C: 4 });
        expect(await counts()).toEqual({ cases: 0, live: 0, events: 0 });
      });
      await withCeiling("5", async () => {
        expect(await aborted()).toBeNull();
        await project();
      });
      expect((await counts()).live).toBe(5);
      // Over the ceiling now (a lowered setting) the abort leaves the stored cases and events exactly as they were.
      const before = await counts();
      await withCeiling("4", async () => {
        expect((await aborted())?.code).toBe("live_case_ceiling");
      });
      expect(await counts()).toEqual(before);
    });

    it("row 9 (semantics): tickets already deleted still count toward the ceiling through N", async () => {
      await setup(tickets(5), 5);
      await run();
      await project();
      await deletionMarker("T-0");
      await project(); // the deletion is within the guard (D = 1 <= 3): T-0 becomes a deleted case
      expect(await counts()).toMatchObject({ cases: 5, live: 4 });
      await withCeiling("5", async () => expect(await aborted()).toBeNull()); // L 4 + N 1 = 5
      await withCeiling("4", async () => {
        const error = await aborted();
        expect(error?.code).toBe("live_case_ceiling"); // only 4 are live, but the deleted ticket is still in the stored set
        expect(error?.details).toMatchObject({ L: 4, N: 1, C: 4 });
      });
    });

    it("row 8: a mass deletion aborts with `mass_deletion` and leaves every case and event untouched", async () => {
      await setup(tickets(10), 10);
      await run();
      await project();
      const before = await counts();
      expect(before).toMatchObject({ cases: 10, live: 10 });
      for (const id of ["T-0", "T-1", "T-2", "T-3"]) await deletionMarker(id); // D = 4 > max(3, 0.05 x 10)
      const error = await aborted();
      expect(error?.code).toBe("mass_deletion");
      expect(error?.details).toMatchObject({ D: 4, L: 10 });
      expect(await counts()).toEqual(before);
      // Three deletions are under the minimum count and apply.
      await prisma.rawEvent.deleteMany({ where: { integrationId, providerEventId: { startsWith: "ticket_deleted:T-3:" } } });
      expect(await aborted()).toBeNull();
    });
  });

  describe("verified-404 deletion markers (row 19)", () => {
    const detailPath = /^\/v2\/tickets\/([^/?]+)(\?|$)/;
    const markers = async () => (await rawIds()).filter((id) => id.startsWith("ticket_deleted:"));

    async function twoPasses(detailStatus: number) {
      let listed = tickets(3);
      await setup(listed, 10, {
        verifyDeletions: true,
        handler: (_cursor, req, res) => {
          const match = detailPath.exec(req.url ?? "");
          if (match && match[1] !== "") {
            res.writeHead(detailStatus, { "content-type": "application/json" }).end("{}");
            return true;
          }
          if (req.url?.startsWith("/v2/tickets")) {
            res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: listed, meta: { next_cursor: null } }));
            return true;
          }
        },
      });
      await run();
      const { projectCanonicalBatch } = await import("@sla/ingestion");
      await projectCanonicalBatch(prisma, { id: integrationId, organizationId, provider: "custom", status: "connected" } as never, await lib.normalizeCustom({ prisma, integration: { id: integrationId, organizationId, provider: "custom", status: "connected" }, mode: "full" } as never));
      listed = tickets(2); // T-2 is no longer listed
      await run();
    }

    it("a 404 from the ticket-detail request for a ticket the list no longer holds writes one permanent marker", async () => {
      await twoPasses(404);
      const found = await markers();
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^ticket_deleted:T-2:/);
      expect((await cursor()).pendingVerification).toEqual([]);
    });

    it("any other status (a 400 here) proves nothing: no marker", async () => {
      await twoPasses(400);
      expect(await markers()).toEqual([]);
    });

    it("absence from the list alone never deletes", async () => {
      await twoPasses(200);
      expect(await markers()).toEqual([]);
    });
  });
});
