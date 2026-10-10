/**
 * N10 (D33): the Custom REST adapter refuses to run on its own, before it
 * reads configuration or credentials, when the provider is unavailable to the
 * organization: disabled platform-wide, or the organization is not on its Beta
 * allowlist (which replaced `Organization.customProviderEnabled`). The worker
 * already skips such an integration; this keeps the adapter safe if called
 * directly.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"
 * (every test truncates all tables). Skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { IntegrationNotConfiguredError, type IngestContext } from "@sla/ingestion";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Custom REST ingest availability gate (real Postgres)", () => {
  let prisma: PrismaClient;
  let runCustomIngest: typeof import("../src/index").runCustomIngest;
  let organizationId: string;
  let integrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    ({ runCustomIngest } = await import("../src/index"));
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    organizationId = (await prisma.organization.create({ data: { name: "Custom" } })).id;
    // An active version that points at nothing: an available run fails on the config, which proves the gate was passed.
    integrationId = (await prisma.integration.create({ data: { organizationId, provider: "custom", credentials: {}, activeConfigVersion: 1 } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const run = () =>
    runCustomIngest({
      prisma,
      integration: { id: integrationId, organizationId, provider: "custom", status: "connected" },
      logger: { info() {}, warn() {}, error() {}, child() { return this; } },
      appUrl: null,
      loadOAuthConfig: async () => null,
    } as unknown as IngestContext);

  it("refuses an organization that is not on the Custom REST allowlist", async () => {
    await expect(run()).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });

  it("passes the gate for an allowlisted organization", async () => {
    await prisma.integrationBetaAllowlist.create({ data: { provider: "custom", organizationId, addedByEmail: "ops@elapsed.test" } });
    await expect(run()).rejects.toMatchObject({ name: "CustomIngestError", code: "config_invalid" });
  });

  it("refuses an allowlisted organization while Custom REST is disabled platform-wide", async () => {
    await prisma.integrationBetaAllowlist.create({ data: { provider: "custom", organizationId, addedByEmail: "ops@elapsed.test" } });
    await prisma.integrationAvailability.create({ data: { provider: "custom", enabled: false, releaseStage: "beta" } });
    await expect(run()).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });
});
