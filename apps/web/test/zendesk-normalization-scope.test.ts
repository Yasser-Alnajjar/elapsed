/**
 * Roadmap task 2.4: a Zendesk webhook re-processes only the affected
 * ticket, not every ticket the integration has ever seen. `runZendeskNormalization`'s
 * new `{ ticketIds }` scope (packages/zendesk/src/normalize.ts) is what the
 * webhook route now passes — this proves a scoped run for one ticket never
 * touches another ticket's Case, even when that other ticket also has a
 * newer, unprocessed RawEvent snapshot sitting in the same integration.
 *
 * Real Postgres, like zendesk-ticket-tags.test.ts. Needs a migrated database
 * at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeZendesk } from "./ingest-helpers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const CREATED_AT = "2026-09-01T09:00:00Z";

describe.skipIf(!TEST_DATABASE_URL)("Zendesk normalization ticket scoping (real Postgres)", () => {
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

    const organization = await prisma.organization.create({ data: { name: "Scope Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    integrationId = integration.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function ticketRawEvent(id: number, subject: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      subject,
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

  async function seedTicket(id: number, payload: object, providerEventId: string) {
    await prisma.rawEvent.create({
      data: { integrationId, providerEventId, sourceHash: providerEventId, payload },
    });
  }

  it("a scoped run for one ticket never creates a Case for a different ticket in the same integration", async () => {
    await seedTicket(1, ticketRawEvent(1, "Ticket A"), "ticket:1:hash-1");
    await seedTicket(2, ticketRawEvent(2, "Ticket B"), "ticket:2:hash-1");

    await normalizeZendesk(prisma, integrationId, { ticketIds: [1] });

    const caseA = await prisma.case.findFirst({ where: { organizationId, externalId: "1" } });
    const caseB = await prisma.case.findFirst({ where: { organizationId, externalId: "2" } });
    expect(caseA).not.toBeNull();
    expect(caseA?.subject).toBe("Ticket A");
    expect(caseB).toBeNull();
  });

  it("a scoped run never rewrites a different ticket's already-existing Case, even with a newer unprocessed snapshot", async () => {
    await seedTicket(1, ticketRawEvent(1, "Ticket A v1"), "ticket:1:hash-1");
    await seedTicket(2, ticketRawEvent(2, "Ticket B v1"), "ticket:2:hash-1");
    await normalizeZendesk(prisma, integrationId);

    // Ticket B gets a new snapshot (as if Zendesk changed it), but only
    // ticket A's webhook fires.
    await seedTicket(1, ticketRawEvent(1, "Ticket A v2"), "ticket:1:hash-2");
    await seedTicket(2, ticketRawEvent(2, "Ticket B v2"), "ticket:2:hash-2");

    await normalizeZendesk(prisma, integrationId, { ticketIds: [1] });

    const caseA = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "1" } });
    const caseB = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "2" } });
    expect(caseA.subject).toBe("Ticket A v2");
    // B's newer snapshot was never picked up by the scoped run.
    expect(caseB.subject).toBe("Ticket B v1");
  });

  it("an unscoped run (the worker's full-account cycle) still picks up every ticket", async () => {
    await seedTicket(1, ticketRawEvent(1, "Ticket A"), "ticket:1:hash-1");
    await seedTicket(2, ticketRawEvent(2, "Ticket B"), "ticket:2:hash-1");

    await normalizeZendesk(prisma, integrationId);

    const caseA = await prisma.case.findFirst({ where: { organizationId, externalId: "1" } });
    const caseB = await prisma.case.findFirst({ where: { organizationId, externalId: "2" } });
    expect(caseA).not.toBeNull();
    expect(caseB).not.toBeNull();
  });

  it("scoping also filters audits, which carry no ticket id in their own providerEventId — a new audit for a different ticket is ignored by a scoped run", async () => {
    await seedTicket(1, ticketRawEvent(1, "Ticket A"), "ticket:1:hash-1");
    await seedTicket(2, ticketRawEvent(2, "Ticket B"), "ticket:2:hash-1");
    await normalizeZendesk(prisma, integrationId);

    const caseB = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "2" } });
    const eventsBefore = await prisma.normalizedEvent.count({ where: { caseId: caseB.id } });

    // A new status-change audit for ticket B only — the webhook that fires
    // is for ticket A.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "ticket_audit:9001",
        sourceHash: "ticket_audit:9001",
        payload: {
          id: 9001,
          ticket_id: 2,
          created_at: "2026-09-01T10:00:00Z",
          author_id: 1,
          via: { channel: "web" },
          events: [{ id: 1, type: "Change", field_name: "status", value: "solved", previous_value: "open" }],
        },
      },
    });

    await normalizeZendesk(prisma, integrationId, { ticketIds: [1] });

    const eventsAfter = await prisma.normalizedEvent.count({ where: { caseId: caseB.id } });
    expect(eventsAfter).toBe(eventsBefore);
  });
});
