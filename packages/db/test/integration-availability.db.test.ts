/**
 * D33 / N10 against a real Postgres: availability has no cache, so a change
 * written through one connection pool (a web instance) is what the very next
 * read through a separate pool (a worker process) sees, with no restart,
 * message bus or other infrastructure. Also: the resolver reads the persisted
 * row over the catalog default.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"
 * (every test truncates all tables). Skipped when unset.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { resolveIntegrationAvailability, resolveOrganizationAvailability } from "../src/integration-availability";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("integration availability propagation (real Postgres)", () => {
  /** Two independent pools, as two processes would have. */
  let web: PrismaClient;
  let worker: PrismaClient;
  let organizationId: string;

  beforeAll(() => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    web = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL! }) });
    worker = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL! }) });
  });

  beforeEach(async () => {
    const tables = await web.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await web.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    organizationId = (await web.organization.create({ data: { name: "Acme" } })).id;
  });

  afterAll(async () => {
    await web?.$disconnect();
    await worker?.$disconnect();
  });

  it("a disable written by one process is seen by the next check in another, and so is the re-enable", async () => {
    expect((await resolveOrganizationAvailability(worker, organizationId)).zendesk.available).toBe(true);

    await web.integrationAvailability.create({ data: { provider: "zendesk", enabled: false, releaseStage: "stable", updatedByEmail: "ops@elapsed.test" } });
    expect((await resolveOrganizationAvailability(worker, organizationId)).zendesk).toMatchObject({ available: false, code: "integration_disabled" });
    expect(await resolveIntegrationAvailability(worker, organizationId, "zendesk")).toMatchObject({ available: false });

    await web.integrationAvailability.update({ where: { provider: "zendesk" }, data: { enabled: true, version: { increment: 1 } } });
    expect((await resolveOrganizationAvailability(worker, organizationId)).zendesk.available).toBe(true);
  });

  it("an allowlist change reaches the other process on its next check", async () => {
    expect((await resolveIntegrationAvailability(worker, organizationId, "custom")).available).toBe(false);
    await web.integrationBetaAllowlist.create({ data: { provider: "custom", organizationId, addedByEmail: "ops@elapsed.test" } });
    expect((await resolveIntegrationAvailability(worker, organizationId, "custom")).available).toBe(true);
    await web.integrationBetaAllowlist.delete({ where: { provider_organizationId: { provider: "custom", organizationId } } });
    expect((await resolveIntegrationAvailability(worker, organizationId, "custom")).available).toBe(false);
  });

  it("deleting an organization removes its allowlist entries (cascade), never a provider's policy", async () => {
    await web.integrationAvailability.create({ data: { provider: "intercom", enabled: true, releaseStage: "beta", betaAccess: "allowlist" } });
    await web.integrationBetaAllowlist.create({ data: { provider: "intercom", organizationId, addedByEmail: "ops@elapsed.test" } });
    await web.organization.delete({ where: { id: organizationId } });
    expect(await web.integrationBetaAllowlist.count()).toBe(0);
    expect(await web.integrationAvailability.count()).toBe(1);
  });
});
