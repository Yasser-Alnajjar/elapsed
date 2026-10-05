/**
 * N3.1: an integration's sync health across success → failure → failure →
 * success, through the real worker cycle against real Postgres (only the Linear
 * HTTP API is faked):
 *
 *  - a clean sync sets `lastSuccessfulSyncAt` and `lastSyncDurationMs`, and
 *    leaves `consecutiveFailures` at 0 and `failingSince` empty;
 *  - a failed sync leaves `lastSuccessfulSyncAt` where it was, increments
 *    `consecutiveFailures` and sets `failingSince`;
 *  - a second failure increments again but does NOT move `failingSince` (it
 *    marks the start of the outage, not the latest retry);
 *  - the next clean sync advances `lastSuccessfulSyncAt` and clears both.
 *
 * Needs a migrated TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";
import type { WorkerConfig } from "../src/config";
import { runCycle } from "../src/cycle";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => undefined);

const config = { appUrl: "http://localhost:3000", organizationConcurrency: 2 } as WorkerConfig;
const emptyIssues = { data: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!TEST_DATABASE_URL)("integration sync health (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");
  let providerUp = true;
  const originalKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "test-integration-token-secret";
    providerUp = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (providerUp ? new Response(JSON.stringify(emptyIssues), { status: 200 }) : new Response("{}", { status: 400 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = originalKey;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("tracks the last success, the failure streak and where the outage began", async () => {
    const organization = await prisma.organization.create({ data: { name: "Health" } });
    const integration = await prisma.integration.create({
      data: {
        organizationId: organization.id,
        provider: "linear",
        credentials: { accessToken: "tok", tokenType: "Bearer", scope: "read" },
      },
    });
    const row = () => prisma.integration.findUniqueOrThrow({ where: { id: integration.id } });
    const sync = () => runCycle(prisma, config, "active_set_poll", undefined, { organizationIds: [organization.id] });

    // Never synced.
    expect(await row()).toMatchObject({ lastSuccessfulSyncAt: null, consecutiveFailures: 0, failingSince: null, lastSyncDurationMs: null });

    // success
    await sync();
    const first = await row();
    expect(first.lastSuccessfulSyncAt).not.toBeNull();
    expect(first.lastSyncDurationMs).toBeGreaterThanOrEqual(0);
    expect(first).toMatchObject({ consecutiveFailures: 0, failingSince: null, lastSyncError: null });

    // failure: the last success stays, the streak starts
    providerUp = false;
    await pause(5);
    await sync();
    const failed1 = await row();
    expect(failed1.lastSyncError).toMatch(/Linear API error 400/);
    expect(failed1.lastSuccessfulSyncAt).toEqual(first.lastSuccessfulSyncAt);
    expect(failed1.consecutiveFailures).toBe(1);
    expect(failed1.failingSince).not.toBeNull();

    // second failure: the streak grows, the outage start does not move
    await pause(5);
    await sync();
    const failed2 = await row();
    expect(failed2.consecutiveFailures).toBe(2);
    expect(failed2.failingSince).toEqual(failed1.failingSince);
    expect(failed2.lastSuccessfulSyncAt).toEqual(first.lastSuccessfulSyncAt);

    // recovery: the success moves forward and the failure state clears
    providerUp = true;
    await pause(5);
    await sync();
    const recovered = await row();
    expect(recovered.lastSuccessfulSyncAt!.getTime()).toBeGreaterThan(first.lastSuccessfulSyncAt!.getTime());
    expect(recovered).toMatchObject({ consecutiveFailures: 0, failingSince: null, lastSyncError: null });
  });
});
