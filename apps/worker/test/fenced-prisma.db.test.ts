/**
 * The lease fence on Integration writes, against real Postgres: a worker that
 * lost its lease can't move the provider cursor (or any other Integration
 * field), atomically — the same statement that would write it checks the
 * fencing token. Needs a migrated TEST_DATABASE_URL whose name contains
 * "test"; skipped when unset.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@sla/db";
import { createFencedPrisma } from "../src/fenced-prisma";
import { LeaseLostError } from "../src/lease";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("createFencedPrisma (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");

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
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function orgWithIntegration(name: string) {
    const org = await prisma.organization.create({ data: { name } });
    const integration = await prisma.integration.create({
      data: { organizationId: org.id, provider: "linear", credentials: { accessToken: "t" }, cursor: { v: 0 } },
    });
    return { org, integration };
  }

  async function claimFor(organizationId: string, owner: string) {
    await db.ensureOrganizationWorkStates(prisma, { reconciliationIntervalMs: 30 * 60_000 });
    await prisma.$executeRaw`UPDATE "organization_work_states" SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "activeNextDueAt" = now() WHERE "organizationId" = ${organizationId}`;
    const claims = await db.claimDueOrganizations(prisma, { owner, limit: 10 });
    return claims.find((c) => c.organizationId === organizationId)!;
  }

  const cursorOf = async (id: string) => (await prisma.integration.findUniqueOrThrow({ where: { id } })).cursor;

  it("lets the current lease holder write the integration", async () => {
    const { org, integration } = await orgWithIntegration("A");
    const claim = await claimFor(org.id, "w1");
    const fenced = createFencedPrisma(prisma, claim);

    await fenced.integration.update({ where: { id: integration.id }, data: { cursor: { v: 1 } } });
    expect(await cursorOf(integration.id)).toEqual({ v: 1 });
    const many = await fenced.integration.updateMany({ where: { id: integration.id, status: "connected" }, data: { lastSyncError: "x" } });
    expect(many.count).toBe(1);
  });

  it("rejects a stale holder's cursor write once the lease was re-claimed — and leaves the new owner's cursor alone", async () => {
    const { org, integration } = await orgWithIntegration("A");
    const stale = await claimFor(org.id, "slow-worker");
    await prisma.$executeRaw`UPDATE "organization_work_states" SET "leaseExpiresAt" = now() - interval '1 second' WHERE "organizationId" = ${org.id}`;
    const current = await db.claimDueOrganizations(prisma, { owner: "fast-worker", limit: 1 });
    expect(current[0]!.leaseToken).toBeGreaterThan(stale.leaseToken);

    // The new owner advances the cursor...
    await createFencedPrisma(prisma, current[0]!).integration.update({ where: { id: integration.id }, data: { cursor: { v: 2 } } });

    // ...and the stale worker, waking up, cannot roll it back.
    const staleClient = createFencedPrisma(prisma, stale);
    await expect(staleClient.integration.update({ where: { id: integration.id }, data: { cursor: { v: 1 } } })).rejects.toThrow(LeaseLostError);
    expect(await cursorOf(integration.id)).toEqual({ v: 2 });

    // updateMany (the compare-and-swap writes) matches nothing.
    const many = await staleClient.integration.updateMany({ where: { id: integration.id }, data: { lastSyncError: "stale" } });
    expect(many.count).toBe(0);
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: integration.id } })).lastSyncError).toBeNull();
  });

  it("rejects writes after the run completed (the lease is gone)", async () => {
    const { org, integration } = await orgWithIntegration("A");
    const claim = await claimFor(org.id, "w1");
    await db.completeWork(prisma, claim, { failed: false, activeIntervalMs: 10_000, reconciliationIntervalMs: 30 * 60_000 });
    await expect(createFencedPrisma(prisma, claim).integration.update({ where: { id: integration.id }, data: { cursor: { v: 9 } } })).rejects.toThrow(LeaseLostError);
    expect(await cursorOf(integration.id)).toEqual({ v: 0 });
  });

  it("a lease on one organization grants no write on another organization's integration (tenant isolation)", async () => {
    const a = await orgWithIntegration("A");
    const b = await orgWithIntegration("B");
    const claimA = await claimFor(a.org.id, "w1");
    const fencedA = createFencedPrisma(prisma, claimA);

    await expect(fencedA.integration.update({ where: { id: b.integration.id }, data: { cursor: { v: 66 } } })).rejects.toThrow(LeaseLostError);
    expect((await fencedA.integration.updateMany({ where: { id: b.integration.id }, data: { cursor: { v: 66 } } })).count).toBe(0);
    expect(await cursorOf(b.integration.id)).toEqual({ v: 0 });
  });

  it("does not interfere with reads or other models", async () => {
    const { org, integration } = await orgWithIntegration("A");
    const fenced = createFencedPrisma(prisma, await claimFor(org.id, "w1"));
    expect((await fenced.integration.findUniqueOrThrow({ where: { id: integration.id } })).id).toBe(integration.id);
    await fenced.rawEvent.createMany({ data: [{ integrationId: integration.id, providerEventId: "e1", sourceHash: "h", payload: {} }], skipDuplicates: true });
    expect(await fenced.rawEvent.count()).toBe(1);
  });
});
