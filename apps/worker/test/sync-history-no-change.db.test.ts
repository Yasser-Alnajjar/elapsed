/**
 * D32: a successful sync that changed nothing is not stored as a sync run, and
 * the two timestamps stay apart. Through the real worker cycle and the real
 * projector against real Postgres (only the Linear HTTP API is faked, and the
 * adapter's normalize returns the batch the test sets).
 *
 *  - a sync that changes data stores one run and sets `lastDataChangedAt`;
 *  - repeated syncs of the same data store nothing, advance `lastSuccessfulSyncAt`
 *    and leave `lastDataChangedAt` alone;
 *  - an assignee/priority edit is a change; a failed sync is stored with its code
 *    and every retry is stored; the clean sync after it is not stored but
 *    supersedes it;
 *  - a run with a ticket-level failure is stored although nothing changed.
 *
 * Needs a migrated TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";
import type { CanonicalBatch } from "@sla/ingestion";
import type { WorkerConfig } from "../src/config";
import { runCycle } from "../src/cycle";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => undefined);

const state = vi.hoisted(() => ({ batch: null as unknown }));
vi.mock("../src/providers", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/providers")>();
  return {
    ...original,
    PROVIDERS: {
      ...original.PROVIDERS,
      linear: {
        ...original.PROVIDERS.linear,
        correlate: vi.fn().mockResolvedValue({ links: [], sweeps: [], evaluated: 0, unmatched: {} }),
        normalize: vi.fn(async () => state.batch),
      },
    },
  };
});

const config = { appUrl: "http://localhost:3000", organizationConcurrency: 2 } as WorkerConfig;
const emptyIssues = { data: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const batchOf = (overrides: { assigneeName?: string | null; priority?: string | null; failures?: CanonicalBatch["failures"] } = {}): CanonicalBatch => ({
  customers: [{ provider: "linear", kind: "organization", externalId: "900", name: "Acme" }],
  cases: [
    {
      externalId: "T-1",
      subject: "Cannot log in",
      assigneeName: overrides.assigneeName ?? "Ada",
      priority: overrides.priority ?? "high",
      channel: "web",
      openedAt: new Date("2026-09-01T09:00:00Z"),
      closedAt: null,
      customer: { provider: "linear", kind: "organization", externalId: "900" },
    },
  ],
  eventGroups: [],
  deletedCaseExternalIds: [],
  failures: overrides.failures ?? [],
});

describe.skipIf(!TEST_DATABASE_URL)("no-change sync history (real Postgres)", () => {
  let prisma: PrismaClient;
  let providerUp = true;
  let organizationId: string;
  let integrationId: string;
  const originalKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-integration-token-secret";
    providerUp = true;
    state.batch = batchOf();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (providerUp ? new Response(JSON.stringify(emptyIssues), { status: 200 }) : new Response("{}", { status: 400 }))),
    );
    organizationId = (await prisma.organization.create({ data: { name: "History" } })).id;
    integrationId = (
      await prisma.integration.create({
        data: { organizationId, provider: "linear", credentials: { accessToken: "tok", tokenType: "Bearer", scope: "read" } },
      })
    ).id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = originalKey;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const sync = async () => {
    await pause(5);
    await runCycle(prisma, config, "active_set_poll", undefined, { organizationIds: [organizationId] });
  };
  const row = () => prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const runs = () => prisma.integrationSyncRun.findMany({ where: { integrationId }, orderBy: { startedAt: "asc" } });

  it("stores a run that changed data and sets both timestamps to that run's finish time", async () => {
    await sync();
    const stored = await runs();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ outcome: "ok", reasonCode: null, casesWritten: 1, failureCount: 0 });
    const integration = await row();
    expect(integration.lastDataChangedAt).toEqual(stored[0]!.finishedAt);
    expect(integration.lastSuccessfulSyncAt).toEqual(stored[0]!.finishedAt);
  });

  it("stores nothing for consecutive no-change syncs, but advances the last check and not the last data update", async () => {
    await sync();
    const first = await row();

    await sync();
    const second = await row();
    await sync();
    const third = await row();

    expect(await runs()).toHaveLength(1);
    expect(second.lastSuccessfulSyncAt!.getTime()).toBeGreaterThan(first.lastSuccessfulSyncAt!.getTime());
    expect(third.lastSuccessfulSyncAt!.getTime()).toBeGreaterThan(second.lastSuccessfulSyncAt!.getTime());
    expect(second.lastDataChangedAt).toEqual(first.lastDataChangedAt);
    expect(third.lastDataChangedAt).toEqual(first.lastDataChangedAt);
    expect(third.lastSyncAt!.getTime()).toBeGreaterThan(first.lastSyncAt!.getTime());
    expect(third).toMatchObject({ consecutiveFailures: 0, failingSince: null, lastSyncError: null });
  });

  it("stores a run for an assignee or priority edit and moves the last data update", async () => {
    await sync();
    const first = await row();

    state.batch = batchOf({ assigneeName: "Grace" });
    await sync();
    state.batch = batchOf({ assigneeName: "Grace", priority: "low" });
    await sync();

    const stored = await runs();
    expect(stored).toHaveLength(3);
    expect(stored.map((r) => r.casesWritten)).toEqual([1, 1, 1]);
    const last = await row();
    expect(last.lastDataChangedAt!.getTime()).toBeGreaterThan(first.lastDataChangedAt!.getTime());
    expect(last.lastDataChangedAt).toEqual(stored[2]!.finishedAt);
    expect(await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "T-1" } })).toMatchObject({ assigneeName: "Grace", priority: "low" });
  });

  it("stores every failed attempt and its retry without moving the data timestamp; the clean sync after is not stored but supersedes the failure", async () => {
    await sync();
    const base = await row();

    providerUp = false;
    await sync();
    await sync();
    const afterFailures = await row();
    const stored = await runs();
    expect(stored.map((r) => r.outcome)).toEqual(["ok", "failed", "failed"]);
    expect(stored[1]!.reasonCode).not.toBeNull();
    expect(afterFailures.consecutiveFailures).toBe(2);
    expect(afterFailures.lastDataChangedAt).toEqual(base.lastDataChangedAt);
    expect(afterFailures.lastSuccessfulSyncAt).toEqual(base.lastSuccessfulSyncAt);

    providerUp = true;
    await sync();
    const recovered = await row();
    expect(await runs()).toHaveLength(3);
    expect(recovered).toMatchObject({ consecutiveFailures: 0, failingSince: null, lastSyncError: null });
    expect(recovered.lastDataChangedAt).toEqual(base.lastDataChangedAt);
    const { isRunSuperseded } = await import("@sla/custom-ticket");
    const [, failedOnce, failedTwice] = await runs();
    expect(isRunSuperseded(failedOnce!, recovered.lastSuccessfulSyncAt)).toBe(true);
    expect(isRunSuperseded(failedTwice!, recovered.lastSuccessfulSyncAt)).toBe(true);
  });

  it("stores a run with a ticket-level failure although no data changed, and keeps storing it while it persists", async () => {
    await sync();
    state.batch = batchOf({ failures: [{ id: "T-2", error: "mapping_error" }] });
    await sync();
    await sync();

    const stored = await runs();
    expect(stored).toHaveLength(3);
    expect(stored[1]).toMatchObject({ outcome: "ok", failureCount: 1, casesWritten: 0 });
    expect(stored[1]!.failures).toEqual([{ recordId: "T-2", code: "mapping_error" }]);

    state.batch = batchOf();
    await sync();
    expect(await runs()).toHaveLength(3);
    const integration = await row();
    expect(integration.lastSuccessfulSyncAt!.getTime()).toBeGreaterThan(stored[2]!.finishedAt!.getTime());
  });
});
