/**
 * N2.3 — Intercom normalization, pinned at the database. Written against
 * the pre-batch `runIntercomNormalization` before the adapter returned batches, and kept as
 * the gate that the batch-then-project path writes the same rows.
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { normalizeIntegration } from "./ingest-helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const T = 1_790_000_000; // epoch seconds

describe.skipIf(!TEST_DATABASE_URL)("Intercom normalization (real Postgres)", () => {
  let prisma: PrismaClient;
  let intercom: typeof import("@sla/intercom");
  let normalize: (integrationId: string) => Promise<{ failed: { id: string; error: string }[] }>;

  let organizationId: string;
  let integrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    intercom = await import("@sla/intercom");
    normalize = async (id) => {
      const result = await normalizeIntegration(prisma, id);
      return { failed: result.failures };
    };
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    organizationId = (await prisma.organization.create({ data: { name: "Intercom Org" } })).id;
    integrationId = (await prisma.integration.create({ data: { organizationId, provider: "intercom", credentials: {} } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seed(input: { providerEventId: string; sourceHash: string; payload: unknown }, fetchedAt?: Date) {
    return prisma.rawEvent.create({
      data: { integrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as object, ...(fetchedAt ? { fetchedAt } : {}) },
    });
  }

  const conversation = (overrides: Record<string, unknown> = {}) => ({
    id: "c1",
    created_at: T,
    updated_at: T + 1000,
    state: "open" as const,
    priority: "priority",
    source: { type: "email", subject: "Cannot log in", author: { type: "user", id: "u1" } },
    contacts: { contacts: [{ id: "p1", type: "contact" }] },
    ...overrides,
  });
  const reply = (id: string, at: number, overrides: Record<string, unknown> = {}) => ({
    id,
    part_type: "comment",
    created_at: at,
    body: "<p>Hello</p>",
    author: { type: "admin", id: "a1", name: "Agent" },
    ...overrides,
  });

  async function seedConversation(c: ReturnType<typeof conversation>, parts: ReturnType<typeof reply>[] = []) {
    const raw = await seed(intercom.mapConversationToRawEvent(c));
    for (const part of parts) await seed(intercom.mapConversationPartToRawEvent(c.id, part));
    return raw;
  }

  const caseRow = (externalId = "c1") =>
    prisma.case.findFirstOrThrow({ where: { organizationId, externalId }, include: { customer: { include: { identities: true } } } });
  const eventsOf = async (caseId: string) =>
    (await prisma.normalizedEvent.findMany({ where: { caseId } })).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.sourceSequence - b.sourceSequence);

  it("projects a conversation with its company customer, priority, assignee and ordered events", async () => {
    await seed(intercom.mapCompanyToRawEvent({ id: "co1", name: "Acme", updated_at: T }));
    await seed(intercom.mapContactToRawEvent({ id: "p1", name: "Pat", companies: { data: [{ id: "co1" }] } }));
    await seed(intercom.mapAdminToRawEvent({ id: "77", name: "Sam Agent" }));
    const raw = await seedConversation(conversation({ admin_assignee_id: 77, state: "closed" }), [
      reply("r1", T + 60),
      reply("r2", T + 120, { part_type: "close", author: { type: "admin", id: "a1" }, body: null }),
    ]);

    const outcome = await normalize(integrationId);

    expect(outcome.failed).toEqual([]);
    const row = await caseRow();
    expect(row).toMatchObject({
      system: "intercom",
      sourceIntegrationId: integrationId,
      subject: "Cannot log in",
      priority: "high",
      channel: "email",
      assigneeName: "Sam Agent",
      requesterName: null,
      tags: [],
      customer: { name: "Acme", identities: [{ provider: "intercom", kind: "company", externalId: "co1" }] },
    });
    expect(row.openedAt).toEqual(new Date(T * 1000));
    expect(row.closedAt).toEqual(new Date((T + 120) * 1000));
    const events = await eventsOf(row.id);
    expect(events.map((e) => [e.type, e.actor, e.fromState, e.toState, e.sourceSequence, e.system, e.sourceRole])).toEqual([
      ["case_created", "customer", null, "open", 0, "intercom", "ticket_source"],
      ["agent_replied", "agent", null, null, 2, "intercom", "ticket_source"],
      ["case_closed", "agent", "open", "resolved", 3, "intercom", "ticket_source"],
    ]);
    expect(events[0]!.sourceRawEventId).toBe(raw.id);
    expect(await prisma.customerIdentity.findMany({ where: { organizationId }, select: { provider: true, kind: true, externalId: true } })).toEqual([
      { provider: "intercom", kind: "company", externalId: "co1" },
    ]);
  });

  it("gives a company-less contact its own customer, named from the contact record", async () => {
    await seed(intercom.mapContactToRawEvent({ id: "p1", name: "Pat Person", email: "pat@example.com" }));
    await seedConversation(conversation());

    await normalize(integrationId);

    expect((await caseRow()).customer).toMatchObject({
      name: "Pat Person",
      identities: [{ provider: "intercom", kind: "contact", externalId: "p1" }],
    });
    expect(await prisma.customerIdentity.findMany({ where: { organizationId }, select: { kind: true, externalId: true } })).toEqual([
      { kind: "contact", externalId: "p1" },
    ]);
  });

  it("names a contact it has no record of after the conversation author, then a placeholder", async () => {
    await seedConversation(conversation({ source: { type: "chat", body: "<p>Hi</p>", author: { type: "user", id: "p1", name: "Author Name" } } }));
    await seedConversation(conversation({ id: "c2", contacts: { contacts: [{ id: "p2", type: "contact" }] }, source: { type: "chat", body: "<p>Hi</p>" } }));

    await normalize(integrationId);

    expect((await caseRow("c1")).customer?.name).toBe("Author Name");
    expect((await caseRow("c2")).customer?.name).toBe("Intercom contact p2");
  });

  it("leaves the customer empty when the conversation has no contact, or the company is unknown", async () => {
    await seed(intercom.mapContactToRawEvent({ id: "p1", companies: { data: [{ id: "ghost" }] } }));
    await seedConversation(conversation({ contacts: { contacts: [] } }));
    await seedConversation(conversation({ id: "c2" }));

    await normalize(integrationId);

    expect((await caseRow("c1")).customerId).toBeNull();
    expect((await caseRow("c2")).customerId).toBeNull();
    expect(await prisma.customer.count({ where: { organizationId } })).toBe(0);
  });

  it("upserts every company even when no conversation mentions it, and renames on a newer snapshot", async () => {
    await seed(intercom.mapCompanyToRawEvent({ id: "co1", name: "Old Name", updated_at: T }), new Date("2026-09-01T00:00:00Z"));
    await seed(intercom.mapCompanyToRawEvent({ id: "co1", name: "New Name", updated_at: T + 5 }), new Date("2026-09-02T00:00:00Z"));
    await seed(intercom.mapCompanyToRawEvent({ id: "co2", name: "Unused", updated_at: T }));

    await normalize(integrationId);

    expect((await prisma.customer.findMany({ where: { organizationId }, orderBy: { name: "asc" } })).map((c) => c.name)).toEqual(["New Name", "Unused"]);
  });

  it("takes the latest snapshot's state and keeps events from older snapshots out", async () => {
    await seed(intercom.mapConversationToRawEvent(conversation({ state: "open" })), new Date("2026-09-01T00:00:00Z"));
    const latest = await seed(
      intercom.mapConversationToRawEvent(conversation({ state: "open", title: "Renamed", updated_at: T + 2000 })),
      new Date("2026-09-02T00:00:00Z"),
    );

    await normalize(integrationId);

    const row = await caseRow();
    expect(row.subject).toBe("Renamed");
    const events = await eventsOf(row.id);
    expect(events.filter((e) => e.type === "case_created").map((e) => e.sourceRawEventId)).toEqual([latest.id]);
  });

  it("is idempotent: a second run leaves every event row, id and createdAt unchanged", async () => {
    await seedConversation(conversation(), [reply("r1", T + 60), reply("r2", T + 90, { author: { type: "user", id: "u1" } })]);
    await normalize(integrationId);
    const before = await prisma.normalizedEvent.findMany({ orderBy: { id: "asc" } });
    const caseBefore = await caseRow();

    await normalize(integrationId);

    const after = await prisma.normalizedEvent.findMany({ orderBy: { id: "asc" } });
    expect(after.map((e) => [e.type, e.occurredAt, e.sourceSequence])).toEqual(before.map((e) => [e.type, e.occurredAt, e.sourceSequence]));
    expect(await prisma.case.count({ where: { organizationId } })).toBe(1);
    expect((await caseRow()).customerId).toBe(caseBefore.customerId);
  });

  it("replaces events when a new part arrives and never touches another provider's events on the case", async () => {
    await seedConversation(conversation(), [reply("r1", T + 60)]);
    await normalize(integrationId);
    const row = await caseRow();
    const jira = await prisma.integration.create({ data: { organizationId, provider: "jira", credentials: {} } });
    const jiraRaw = await prisma.rawEvent.create({ data: { integrationId: jira.id, providerEventId: "issue:ENG-1:h", sourceHash: "h", payload: {} } });
    await prisma.normalizedEvent.create({
      data: { caseId: row.id, sourceRawEventId: jiraRaw.id, type: "state_changed", occurredAt: new Date((T + 30) * 1000), actor: "agent", system: "jira", sourceRole: "work_tracker", toState: "in_progress" },
    });

    await seed(intercom.mapConversationPartToRawEvent("c1", reply("r2", T + 200, { author: { type: "user", id: "u1" } })));
    await normalize(integrationId);

    const events = await eventsOf(row.id);
    expect(events.map((e) => [e.system, e.type])).toEqual([
      ["intercom", "case_created"],
      ["jira", "state_changed"],
      ["intercom", "agent_replied"],
      ["intercom", "customer_replied"],
    ]);
  });

  it("treats an unrecognised conversation state as not closed, and still projects the others", async () => {
    await seedConversation(conversation({ id: "bad", state: "mystery" as never }));
    await seedConversation(conversation({ id: "c2" }));

    const outcome = await normalize(integrationId);

    expect(outcome.failed).toHaveLength(0);
    expect(await prisma.case.count({ where: { organizationId } })).toBe(2);
  });
});
