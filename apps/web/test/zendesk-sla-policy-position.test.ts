/**
 * Phase 1.10 / D6: imported Zendesk policies match in Zendesk's own
 * `position` order — a lower position wins, ahead of specificity — instead
 * of the old specificity-only ranking. `runZendeskSlaPolicyImport` now
 * writes each policy's `position` onto `SLAPolicy`, and `matchPolicyVersion`
 * (packages/core) ranks a positioned candidate above an unpositioned one and
 * a lower position above a higher one, before falling back to specificity.
 *
 * Real Postgres, like zendesk-sla-policy-archive.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Zendesk SLA policy position matching (real Postgres)", () => {
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

    const organization = await prisma.organization.create({ data: { name: "Position Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    integrationId = integration.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function writePolicySnapshot(
    id: number,
    title: string,
    position: number | undefined,
    filter?: { all?: { field: string; operator: string; value: string }[] },
  ) {
    const hash = `h-${id}-${position ?? "none"}`;
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: `sla_policy:${id}:${hash}`,
        sourceHash: hash,
        payload: {
          id,
          title,
          position,
          filter,
          policy_metrics: [{ priority: null, metric: "first_reply_time", target: 60, business_hours: false }],
        },
      },
    });
  }

  it("stores the imported policy's Zendesk position", async () => {
    await writePolicySnapshot(1, "Standard", 3);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    const policy = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId } });
    expect(policy.position).toBe(3);
  });

  it("leaves position null when Zendesk's payload doesn't carry one", async () => {
    await writePolicySnapshot(1, "Standard", undefined);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    const policy = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId } });
    expect(policy.position).toBeNull();
  });

  it("matches by position, not specificity: a lower-position catch-all wins over a higher-position specific policy", async () => {
    // "Urgent" is more specific (priority: urgent) but sits at a HIGHER
    // (later-evaluated) Zendesk position than the unrestricted "Catch-all".
    await writePolicySnapshot(1, "Catch-all", 1);
    await writePolicySnapshot(2, "Urgent", 2, {
      all: [{ field: "priority", operator: "is", value: "urgent" }],
    });
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    const zCase = await prisma.case.create({
      data: { organizationId, system: "zendesk", externalId: "case-1", priority: "urgent", openedAt: new Date("2026-09-17T10:00:00.000Z") },
    });
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const created = await prisma.commitment.findFirstOrThrow({ where: { caseId: zCase.id } });
    const matchedPolicy = await prisma.sLAPolicy.findFirstOrThrow({
      where: { versions: { some: { id: created.policyVersionId } } },
    });
    expect(matchedPolicy.name).toBe("Catch-all");
  });

  it("re-importing updates position when Zendesk's own order changes", async () => {
    await writePolicySnapshot(1, "Standard", 1);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    expect((await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId } })).position).toBe(1);

    await writePolicySnapshot(1, "Standard", 4);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);
    expect((await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId } })).position).toBe(4);
  });

  /**
   * Regression for the reported bug: a ticket matching a tag-filtered policy
   * (position 1), an organization-filtered policy (position 2), and an
   * unfiltered catch-all (position 3) must land on position 1 — not on the
   * catch-all. Before the fix, both the tag and organization policies were
   * silently excluded as candidates: `organization_id` was duplicated into
   * the generic `conditions` group (which a case's attributes never satisfy,
   * since only `customerId` is set — see `extractMatchFromFilter`), and a
   * Case never carried its source ticket's tags at all (see `Case.tags` /
   * `normalize.ts`), so a `tags` condition could never be satisfied either.
   * That left the catch-all as the only surviving candidate regardless of
   * position.
   */
  it("matches a tag-filtered policy over an organization-filtered policy and a catch-all, by position", async () => {
    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: "Acme",
        zendeskOrgId: "555",
        identities: { create: { organizationId, provider: "zendesk", kind: "organization", externalId: "555" } },
      },
    });

    await writePolicySnapshot(1, "D6-Org Ticket Tag - d6", 1, {
      all: [{ field: "tags", operator: "contains", value: "d6" }],
    });
    await writePolicySnapshot(2, "D6 - Organization Policy", 2, {
      all: [{ field: "organization_id", operator: "is", value: "555" }],
    });
    await writePolicySnapshot(3, "Set first reply time", 3);
    await zendesk.runZendeskSlaPolicyImport(prisma, integrationId, ensureDefaultCalendar);

    const zCase = await prisma.case.create({
      data: {
        organizationId,
        system: "zendesk",
        externalId: "ticket-2",
        customerId: customer.id,
        tags: ["d6", "customer-visible"],
        priority: "normal",
        openedAt: new Date("2026-09-17T10:00:00.000Z"),
      },
    });
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const created = await prisma.commitment.findFirstOrThrow({ where: { caseId: zCase.id } });
    const matchedPolicy = await prisma.sLAPolicy.findFirstOrThrow({
      where: { versions: { some: { id: created.policyVersionId } } },
    });
    expect(matchedPolicy.name).toBe("D6-Org Ticket Tag - d6");
  });
});
