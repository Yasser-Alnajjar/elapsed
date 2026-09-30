/**
 * N1.11: an imported SLA policy is scoped to the provider it came from
 * (`SLAPolicy.sourceProvider`), so a Zendesk policy never prices an Intercom
 * case in the same organization. Real Postgres, like zendesk-sla-condition-fields.test.ts.
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("imported policy source scope (real Postgres)", () => {
  let prisma: PrismaClient;
  let zendesk: typeof import("@sla/zendesk");
  let commitments: typeof import("@sla/commitments");
  // The Zendesk importer no longer depends on @sla/commitments (N1.12): the caller supplies the default calendar.
  const ensureDefaultCalendar = (organizationId: string) =>
    commitments.ensureDefaultCalendarVersion(prisma, organizationId);

  let organizationId: string;
  let integrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    zendesk = await import("@sla/zendesk");
    commitments = await import("@sla/commitments");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Source Scope Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    integrationId = integration.id;

    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "sla_policy:1:h1",
        sourceHash: "h1",
        payload: {
          id: 1,
          title: "Zendesk catch-all",
          position: 1,
          policy_metrics: [{ priority: null, metric: "first_reply_time", target: 60, business_hours: false }],
        },
      },
    });
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "ticket:2:h1",
        sourceHash: "h1",
        payload: {
          id: 2,
          subject: "Zendesk ticket",
          created_at: "2026-09-01T09:00:00Z",
          updated_at: "2026-09-01T09:00:00Z",
          status: "open",
          priority: "normal",
          organization_id: null,
          requester_id: 501,
          via: { channel: "web" },
        },
      },
    });
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    await zendesk.runZendeskNormalization(prisma, integrationId);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function addIntercomCase() {
    return prisma.case.create({
      data: { organizationId, externalId: "conv-9", system: "intercom", openedAt: new Date("2026-09-01T09:00:00Z") },
    });
  }

  it("the importer scopes the policy to zendesk", async () => {
    const policy = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId, externalId: { not: null } } });
    expect(policy.source).toBe("imported");
    expect(policy.sourceProvider).toBe("zendesk");
  });

  it("prices the Zendesk case but not an Intercom case in the same organization", async () => {
    const intercomCase = await addIntercomCase();
    const result = await commitments.runCommitmentPipeline(prisma, organizationId);

    const zendeskCase = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "2" } });
    expect(await prisma.commitment.count({ where: { caseId: zendeskCase.id } })).toBeGreaterThan(0);
    expect(await prisma.commitment.count({ where: { caseId: intercomCase.id } })).toBe(0);
    expect(result.casesWithNoMatchingPolicy).toBeGreaterThanOrEqual(1);
  });

  it("a legacy imported policy with no source stays unscoped and still prices every case", async () => {
    await prisma.sLAPolicy.updateMany({ where: { organizationId }, data: { sourceProvider: null } });
    const intercomCase = await addIntercomCase();
    await commitments.runCommitmentPipeline(prisma, organizationId);

    expect(await prisma.commitment.count({ where: { caseId: intercomCase.id } })).toBeGreaterThan(0);
  });
});
