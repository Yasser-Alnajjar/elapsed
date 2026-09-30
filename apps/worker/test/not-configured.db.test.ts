/**
 * What counts against the worker's health, end to end (real Postgres, the real
 * work loop, processor, cycle code and work-state SQL; only the Linear HTTP
 * API is faked):
 *
 *  - an integration the organization has not configured is SKIPPED — no failure,
 *    no failed run, no `consecutiveFailures`, the organization's other
 *    integrations and other organizations carry on, the worker stays healthy;
 *  - a customer-side integration problem (reconnect needed, permission lost) is
 *    recorded on the Integration but is not a worker failure;
 *  - a real provider/stage failure on a configured integration still is one, and
 *    still makes the worker Degraded.
 *
 * Needs a migrated TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";
import { createLogger } from "@sla/logger";
import type { WorkerConfig } from "../src/config";
import { createOrganizationProcessor } from "../src/organization-processor";
import { startWorkLoop, type WorkLoop } from "../src/work-loop";
import { createDbWorkStore } from "../src/work-store";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => undefined);

const config = { appUrl: "http://localhost:3000", organizationConcurrency: 3 } as WorkerConfig;
const emptyIssues = { data: { issues: { nodes: [], pageInfo: { hasNextPage: false } } } };

describe.skipIf(!TEST_DATABASE_URL)("not-configured integrations are skipped, not failures (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");
  let loop: WorkLoop | null = null;
  const fetchedTokens: string[] = [];
  const fetchedUrls: string[] = [];
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
    fetchedTokens.length = 0;
    fetchedUrls.length = 0;
    // The Linear API: the token decides the answer.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { headers: { Authorization: string } }) => {
        const token = init.headers.Authorization.replace("Bearer ", "");
        fetchedUrls.push(url);
        fetchedTokens.push(token);
        if (token === "tok-forbidden") return new Response("{}", { status: 403 });
        if (token === "tok-revoked") return new Response("{}", { status: 401 });
        if (token === "tok-broken") return new Response("{}", { status: 400 });
        return new Response(JSON.stringify(emptyIssues), { status: 200 });
      }),
    );
  });

  afterEach(async () => {
    await loop?.stop(0);
    loop = null;
    vi.unstubAllGlobals();
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = originalKey;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const credentials = (token: string) => ({ accessToken: token, tokenType: "Bearer", scope: "read" });

  async function org(name: string, integrations: { provider: "linear" | "zendesk" | "jira"; token?: string }[]) {
    const organization = await prisma.organization.create({ data: { name } });
    for (const integration of integrations) {
      await prisma.integration.create({
        data: {
          organizationId: organization.id,
          provider: integration.provider,
          credentials: credentials(integration.token ?? "tok-ok"),
        },
      });
    }
    return organization.id;
  }

  /** Runs the real work loop until every organization has had one run recorded, then stops it. */
  async function runEachOnce(organizationIds: string[]) {
    await db.ensureOrganizationWorkStates(prisma, { reconciliationIntervalMs: 30 * 60_000 });
    // Active work due now; reconciliation far away, so each organization is processed exactly once here.
    await prisma.$executeRaw`UPDATE "organization_work_states" SET "reconciliationNextDueAt" = now() + interval '25 minutes'`;
    const readSettings = async () => ({ activeIntervalMs: 3_600_000, reconciliationIntervalMs: 30 * 60_000 });
    loop = startWorkLoop({
      workerId: "w1",
      capacity: 3,
      leaseTtlMs: 60_000,
      claimPollMs: 20,
      logger: createLogger(),
      store: createDbWorkStore(prisma, "w1"),
      process: createOrganizationProcessor({ prisma, config, logger: createLogger(), activePollMs: async () => 3_600_000 }),
      intervals: readSettings,
      onRunRecorded: (claim) => db.recordOrganizationRunOutcome(prisma, claim.kind, claim.startedAt),
    });
    await vi.waitFor(
      async () => {
        const done = await prisma.organizationWorkState.count({ where: { organizationId: { in: organizationIds }, lastFinishedAt: { not: null } } });
        expect(done).toBe(organizationIds.length);
      },
      { timeout: 20_000, interval: 50 },
    );
    const stats = loop.stats();
    await loop.stop(2_000);
    loop = null;
    return stats;
  }

  const state = (organizationId: string) => prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId } });
  const integrationOf = (organizationId: string, provider: "linear" | "zendesk" | "jira") =>
    prisma.integration.findUniqueOrThrow({ where: { organizationId_provider: { organizationId, provider } } });
  const workerStatus = async () => db.deriveWorkerStatus(await db.getOrCreateWorkerSettings(prisma));

  it("one configured + unconfigured integrations: the configured one runs, the others are skipped, the worker stays healthy", async () => {
    const mixed = await org("Mixed", [{ provider: "linear", token: "tok-mixed" }, { provider: "zendesk" }, { provider: "jira" }]);

    const stats = await runEachOnce([mixed]);

    expect(fetchedTokens).toEqual(["tok-mixed"]); // Linear ran; nothing was attempted for Zendesk or Jira
    expect(fetchedUrls.every((url) => url.startsWith("https://api.linear.app/"))).toBe(true);
    expect(stats).toMatchObject({ completed: 1, failedRuns: 0 });
    expect(await state(mixed)).toMatchObject({ consecutiveFailures: 0, lastFailureAt: null, lastError: null, leaseOwner: null });
    expect((await integrationOf(mixed, "linear")).lastSyncError).toBeNull();
    // Still observable on the integration itself, and the integration stays connected.
    expect(await integrationOf(mixed, "zendesk")).toMatchObject({ status: "connected", lastSyncError: "Zendesk is not configured for this organization" });
    expect(await integrationOf(mixed, "jira")).toMatchObject({ status: "connected", lastSyncError: "Jira is not configured for this organization" });
    expect((await prisma.workerSettings.findUniqueOrThrow({ where: { id: "singleton" } })).lastActivePollFailures).toBe(0);
    expect(await workerStatus()).toBe("running");
  });

  it("an organization whose integrations are all unconfigured completes quickly as a clean run — no failure, no counter, worker healthy", async () => {
    const bare = await org("Bare", [{ provider: "zendesk" }, { provider: "jira" }]);

    const started = Date.now();
    const stats = await runEachOnce([bare]);

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fetchedTokens).toEqual([]);
    expect(stats).toMatchObject({ completed: 1, failedRuns: 0 });
    const row = await state(bare);
    expect(row).toMatchObject({ consecutiveFailures: 0, lastFailureAt: null, lastError: null });
    expect(row.lastFinishedAt).not.toBeNull();
    expect(row.activeNextDueAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000); // scheduled normally, not retried
    expect(await db.getWorkStateSummary(prisma)).toMatchObject({ failing: 0 });
    expect(await workerStatus()).toBe("running");
  });

  it("missing configuration in some organizations does not affect the others", async () => {
    const good1 = await org("Good 1", [{ provider: "linear", token: "tok-good-1" }]);
    const bare1 = await org("Bare 1", [{ provider: "zendesk" }]);
    const good2 = await org("Good 2", [{ provider: "linear", token: "tok-good-2" }, { provider: "jira" }]);
    const bare2 = await org("Bare 2", [{ provider: "jira" }, { provider: "zendesk" }]);

    const stats = await runEachOnce([good1, bare1, good2, bare2]);

    expect([...fetchedTokens].sort()).toEqual(["tok-good-1", "tok-good-2"]);
    expect(stats).toMatchObject({ completed: 4, failedRuns: 0 });
    for (const id of [good1, bare1, good2, bare2]) expect(await state(id)).toMatchObject({ consecutiveFailures: 0, lastFailureAt: null });
    expect(await workerStatus()).toBe("running");
  });

  it("a real provider error on a configured integration is still a failure, and still makes the worker Degraded", async () => {
    const fine = await org("Fine", [{ provider: "linear", token: "tok-fine" }, { provider: "zendesk" }]);
    const broken = await org("Broken", [{ provider: "linear", token: "tok-broken" }, { provider: "zendesk" }]);

    const stats = await runEachOnce([fine, broken]);

    expect(stats).toMatchObject({ completed: 2, failedRuns: 1 });
    expect(await state(fine)).toMatchObject({ consecutiveFailures: 0, lastError: null });
    const row = await state(broken);
    expect(row.consecutiveFailures).toBe(1);
    expect(row.lastFailureAt).not.toBeNull();
    expect(row.lastError).toMatch(/^ingest:linear: Linear API error 400/); // the skipped Zendesk is not what failed
    expect(await db.getWorkStateSummary(prisma)).toMatchObject({ failing: 1 });
    expect((await prisma.workerSettings.findUniqueOrThrow({ where: { id: "singleton" } })).lastActivePollFailures).toBe(1);
    expect(await workerStatus()).toBe("degraded");

    // The failure policy is unchanged: once it recovers, the next clean run clears it.
    await prisma.integration.updateMany({ where: { organizationId: broken }, data: { credentials: credentials("tok-fixed") } });
    await prisma.$executeRaw`UPDATE "organization_work_states" SET "activeNextDueAt" = now(), "leaseOwner" = NULL WHERE "organizationId" = ${broken}`;
    await runEachOnce([broken]);
    expect(await state(broken)).toMatchObject({ consecutiveFailures: 0, lastError: null });
    expect(await workerStatus()).toBe("running");
  });

  it("permission and re-authentication failures stay observable on the integration and are never mistaken for 'not configured' — but are not worker failures", async () => {
    const denied = await org("Denied", [{ provider: "linear", token: "tok-forbidden" }]);
    const revoked = await org("Revoked", [{ provider: "linear", token: "tok-revoked" }]);

    const stats = await runEachOnce([denied, revoked]);

    expect(stats).toMatchObject({ completed: 2, failedRuns: 0 });
    const deniedIntegration = await integrationOf(denied, "linear");
    expect(deniedIntegration.status).toBe("permission_denied");
    expect(deniedIntegration.lastSyncError).toMatch(/denied access/);
    const revokedIntegration = await integrationOf(revoked, "linear");
    expect(revokedIntegration.status).toBe("reauth_required");
    expect(revokedIntegration.lastSyncError).toMatch(/needs to be reconnected/);
    expect(deniedIntegration.lastSyncError).not.toMatch(/not configured/);
    for (const id of [denied, revoked]) expect(await state(id)).toMatchObject({ consecutiveFailures: 0, lastFailureAt: null, lastError: null });
    expect(await workerStatus()).toBe("running");
  });
});
