/**
 * Customer/Requester separation (Design C): `Case.requesterName` is a
 * display-only field, resolved from a Zendesk ticket's `requester_id` via
 * the `include=users` sideload and embedded onto the ticket's RawEvent
 * payload as `requester_name` (see `mapTicketToRawEvent`). It must never
 * feed `Customer` resolution — `Customer` stays account/company-only,
 * derived exclusively from `ticket.organization_id`, exactly as before this
 * feature.
 *
 * Real Postgres, like event-ordering-persistence.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeZendesk } from "./ingest-helpers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const REQUESTER = 123;
const CREATED_AT = "2026-09-01T09:00:00Z";

describe.skipIf(!TEST_DATABASE_URL)("Zendesk requester name vs. Customer (real Postgres)", () => {
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

    const organization = await prisma.organization.create({ data: { name: "Requester Org" } });
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
      requester_id: REQUESTER,
      via: { channel: "web" },
      ...overrides,
    };
  }

  async function seedTicket(payload: object) {
    await prisma.rawEvent.create({
      data: { integrationId, providerEventId: "ticket:1:hash-1", sourceHash: "hash-1", payload },
    });
  }

  // 1. Organization-less ticket: customerId stays null, requesterName is populated.
  it("an organization-less ticket gets requesterName but no Customer", async () => {
    await seedTicket(ticketRawEvent({ organization_id: null, requester_name: "Ahmed" }));

    await normalizeZendesk(prisma, integrationId);

    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } });
    expect(caseRow.customerId).toBeNull();
    expect(caseRow.requesterName).toBe("Ahmed");
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(0);
  });

  // 2. Organization-linked ticket: existing Customer resolution is untouched,
  // and the requester is recorded alongside it — never replacing it.
  it("an organization-linked ticket keeps its Customer AND records requesterName separately", async () => {
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "organization:456:hash-org",
        sourceHash: "hash-org",
        payload: { id: 456, name: "Acme Corp", updated_at: CREATED_AT },
      },
    });
    await seedTicket(ticketRawEvent({ organization_id: 456, requester_name: "Ahmed" }));

    await normalizeZendesk(prisma, integrationId);

    const caseRow = await prisma.case.findFirstOrThrow({
      where: { organizationId, externalId: "1" },
      include: { customer: true },
    });
    expect(caseRow.customer?.name).toBe("Acme Corp");
    expect(caseRow.requesterName).toBe("Ahmed");
    // The requester must never become — or be folded into — a Customer row.
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(1);
  });

  // 5. Requester id present but not resolved to a name (e.g. missing from
  // the sideload): requesterName is null, no exception, Customer unaffected.
  it("a ticket whose requester couldn't be resolved to a name gets requesterName: null, not an error", async () => {
    await seedTicket(ticketRawEvent({ organization_id: null, requester_name: null }));

    await expect(normalizeZendesk(prisma, integrationId)).resolves.toMatchObject({
      failures: [],
    });

    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } });
    expect(caseRow.customerId).toBeNull();
    expect(caseRow.requesterName).toBeNull();
  });

  // 6. Re-syncing an existing case backfills requesterName without disturbing its Customer link.
  it("re-normalizing an existing organization-linked case updates requesterName without changing its Customer", async () => {
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "organization:456:hash-org",
        sourceHash: "hash-org",
        payload: { id: 456, name: "Acme Corp", updated_at: CREATED_AT },
      },
    });
    // First sync: as if ingested before this feature existed (no requester_name on the snapshot).
    await seedTicket(ticketRawEvent({ organization_id: 456 }));
    await normalizeZendesk(prisma, integrationId);

    let caseRow = await prisma.case.findFirstOrThrow({
      where: { organizationId, externalId: "1" },
      include: { customer: true },
    });
    expect(caseRow.requesterName).toBeNull();
    const customerId = caseRow.customerId;

    // A later re-sync (poll/webhook) re-fetches the ticket with the sideload and gets a name.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "ticket:1:hash-2",
        sourceHash: "hash-2",
        payload: ticketRawEvent({ organization_id: 456, requester_name: "Ahmed" }),
      },
    });
    await normalizeZendesk(prisma, integrationId);

    caseRow = await prisma.case.findFirstOrThrow({
      where: { organizationId, externalId: "1" },
      include: { customer: true },
    });
    expect(caseRow.requesterName).toBe("Ahmed");
    expect(caseRow.customerId).toBe(customerId);
    expect(caseRow.customer?.name).toBe("Acme Corp");
  });
});
