/**
 * D32 (plan 09, 6.12 and 6.13): a successful sync that changed nothing is not
 * stored, so the page state must not be read from a stale stored run. A stored
 * run is superseded by a later clean check (`lastSuccessfulSyncAt` newer than the
 * run's `finishedAt`) and never otherwise. Real Postgres; needs a migrated
 * TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("custom sync state with unstored no-change runs (real Postgres)", () => {
  let prisma: PrismaClient;
  let getCustomStatus: typeof import("../src/lib/custom-provider/status").getCustomStatus;
  let organizationId: string;
  let integrationId: string;

  const t = (minute: number) => new Date(Date.UTC(2026, 9, 9, 12, minute, 0));
  const NOW = t(59);

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    ({ getCustomStatus } = await import("../src/lib/custom-provider/status"));
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"public"."${x.tablename}"`).join(", ")} CASCADE`);
    organizationId = (await prisma.organization.create({ data: { name: "Custom", customProviderEnabled: true } })).id;
    integrationId = (
      await prisma.integration.create({
        data: {
          organizationId,
          provider: "custom",
          credentials: {},
          cursor: { backfillCompletedAt: t(0).toISOString() },
          lastSuccessfulSyncAt: t(50),
          lastDataChangedAt: t(10),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const run = (startMinute: number, finishMinute: number, data: Record<string, unknown> = {}) =>
    prisma.integrationSyncRun.create({
      data: { organizationId, integrationId, startedAt: t(startMinute), finishedAt: t(finishMinute), outcome: "ok", ...data },
    });
  const lastCleanCheck = (minute: number) => prisma.integration.update({ where: { id: integrationId }, data: { lastSuccessfulSyncAt: t(minute) } });
  const status = () => getCustomStatus(prisma, organizationId, NOW);

  it("is up to date with no stored runs at all, and exposes the two timestamps separately", async () => {
    const s = await status();
    expect(s).toMatchObject({ state: "up_to_date", attention: null, runs: [] });
    expect(s.lastSuccessfulSyncAt).toBe(t(50).toISOString());
    expect(s.lastDataChangedAt).toBe(t(10).toISOString());
  });

  it("returns to up to date when a clean no-change check follows a failed run, and still lists the failed run in the history", async () => {
    await run(20, 21, { outcome: "failed", reasonCode: "provider_unavailable" });
    await lastCleanCheck(30);
    const s = await status();
    expect(s).toMatchObject({ state: "up_to_date", attention: null });
    expect(s.runs.map((r) => r.outcome)).toEqual(["failed"]);
  });

  it("keeps Needs attention for a failure newer than the last clean check", async () => {
    await run(55, 56, { outcome: "failed", reasonCode: "provider_unavailable" });
    expect(await status()).toMatchObject({ state: "needs_attention", attention: "provider" });
  });

  it("never hides a failure that comes after a clean no-change check, however many clean checks came before", async () => {
    await run(20, 21, { outcome: "failed", reasonCode: "timeout" });
    await lastCleanCheck(30);
    expect((await status()).state).toBe("up_to_date");
    await run(40, 41, { outcome: "failed", reasonCode: "credentials_unreadable" });
    expect(await status()).toMatchObject({ state: "needs_attention", attention: "credentials" });
  });

  it("clears the failed-ticket list once a clean check follows, and shows it while the run is the latest", async () => {
    await run(20, 21, { failureCount: 2, failures: [{ recordId: "T-1", code: "mapping_error" }, { recordId: "T-2", code: "mapping_error" }] });
    await lastCleanCheck(21); // the stored run's own success: it does not supersede itself
    const open = await status();
    expect(open.failedTicketCount).toBe(2);
    expect(open.failedTickets.map((f) => f.recordId)).toEqual(["T-1", "T-2"]);

    await lastCleanCheck(30);
    const cleared = await status();
    expect(cleared.failedTicketCount).toBe(0);
    expect(cleared.failedTickets).toEqual([]);
  });

  it("shows Catching up for a partial run and clears it after a clean check", async () => {
    await run(20, 21, { outcome: "partial", reasonCode: "budget_exhausted", progress: { hasIncrementalCursor: true } });
    await lastCleanCheck(10);
    expect((await status()).state).toBe("catching_up");
    await lastCleanCheck(30);
    expect((await status()).state).toBe("up_to_date");
  });

  it("offers a lifecycle abort for override until a clean check supersedes it", async () => {
    await run(20, 21, { outcome: "aborted", reasonCode: "mass_lifecycle_change", progress: { R: 12, L: 20, ratio: 0.6, recordIds: ["T-1"], previewHash: "abc" } });
    await lastCleanCheck(10);
    const pending = await status();
    expect(pending.state).toBe("needs_attention");
    expect(pending.override).toMatchObject({ previewHash: "abc", counts: { R: 12, L: 20 } });

    await lastCleanCheck(30);
    const after = await status();
    expect(after.override).toBeNull();
    expect(after.state).toBe("up_to_date");
  });

  it("leaves the integration-level causes to the integration status, not to the runs", async () => {
    await prisma.integration.update({ where: { id: integrationId }, data: { status: "reauth_required" } });
    expect(await status()).toMatchObject({ state: "needs_attention", attention: "reconnect" });
  });
});
