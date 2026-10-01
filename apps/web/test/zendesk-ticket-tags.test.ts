/**
 * `Case.tags` is populated from a Zendesk ticket's `tags` (D6 fix): a
 * generic SLA policy match condition on field `"tags"` (see
 * `extractMatchFromFilter`, packages/zendesk) can only ever be satisfied if
 * the case it's evaluated against actually carries the ticket's tags —
 * before this, `Case.tags` didn't exist and a tag-filtered policy could
 * never match any ticket.
 *
 * Real Postgres, like zendesk-requester-name.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeZendesk } from "./ingest-helpers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const CREATED_AT = "2026-09-01T09:00:00Z";

describe.skipIf(!TEST_DATABASE_URL)("Zendesk ticket tags -> Case.tags (real Postgres)", () => {
  let prisma: PrismaClient;
  let zendesk: typeof import("@sla/zendesk");

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
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Tags Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    integrationId = integration.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function ticketRawEvent(overrides: Record<string, unknown>) {
    return {
      id: 1,
      subject: "Cannot log in",
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
      status: "open",
      priority: null,
      organization_id: null,
      requester_id: null,
      via: { channel: "web" },
      ...overrides,
    };
  }

  async function seedTicket(payload: object, providerEventId = "ticket:1:hash-1") {
    await prisma.rawEvent.create({
      data: { integrationId, providerEventId, sourceHash: providerEventId, payload },
    });
  }

  it("stores a ticket's tags on the Case", async () => {
    await seedTicket(ticketRawEvent({ tags: ["d6", "customer-visible"] }));

    await normalizeZendesk(prisma, integrationId);

    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } });
    expect(caseRow.tags).toEqual(["d6", "customer-visible"]);
  });

  it("defaults to no tags when the Zendesk payload doesn't carry any", async () => {
    await seedTicket(ticketRawEvent({}));

    await normalizeZendesk(prisma, integrationId);

    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } });
    expect(caseRow.tags).toEqual([]);
  });

  it("re-normalizing an existing case updates its tags to match the latest ticket snapshot", async () => {
    await seedTicket(ticketRawEvent({ tags: ["d6"] }));
    await normalizeZendesk(prisma, integrationId);
    expect((await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } })).tags).toEqual(["d6"]);

    await seedTicket(ticketRawEvent({ tags: ["d6", "escalated"] }), "ticket:1:hash-2");
    await normalizeZendesk(prisma, integrationId);
    expect((await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } })).tags).toEqual([
      "d6",
      "escalated",
    ]);
  });
});
