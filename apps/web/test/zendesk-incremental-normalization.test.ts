/**
 * Roadmap 7.7 Phase 3, item 2: the worker's active-set poll re-derives only
 * the tickets touched by RawEvents newer than `Integration.normalizedThrough*`,
 * while the hourly reconciliation sweep re-derives everything.
 *
 * What has to hold:
 *  - the incremental path finds exactly the tickets that changed (new
 *    snapshot, new audit, changed organization) and leaves the rest alone;
 *  - a RawEvent that committed *behind* the watermark (webhook/backfill
 *    commit out of `fetchedAt` order) is still picked up, within the overlap
 *    window — and anything older is what the full pass is the backstop for;
 *  - a user role snapshot forces a full pass;
 *  - unchanged tickets write nothing: their events keep id and `createdAt`;
 *  - a ticket-scoped (webhook) run never moves the watermark.
 *
 * Real Postgres, like zendesk-normalization-scope.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeZendesk } from "./ingest-helpers";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const CREATED_AT = "2026-09-01T09:00:00Z";
const AGENT = 900;

describe.skipIf(!TEST_DATABASE_URL)("Zendesk normalization, incremental mode (real Postgres)", () => {
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
    organizationId = (await prisma.organization.create({ data: { name: "Incremental Org" } })).id;
    integrationId = (
      await prisma.integration.create({
        data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
      })
    ).id;
    // The audit author's role, from before the watermark so it never forces a full pass.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: `user:${AGENT}:v0`,
        sourceHash: "user-agent",
        payload: { id: AGENT, role: "agent" },
        fetchedAt: OLD,
      },
    });
    // Pins the watermark; not a ticket/audit/org/user row, so it never triggers a re-derivation.
    await prisma.rawEvent.create({
      data: {
        integrationId,
        providerEventId: "sla_policy:anchor",
        sourceHash: "anchor",
        payload: {},
        fetchedAt: WATERMARK_AT,
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const minutes = (n: number) => n * 60 * 1000;
  /**
   * The watermark is the greatest `fetchedAt` seen, and anything within
   * `NORMALIZATION_OVERLAP_MS` of it is deliberately re-read. So rows an
   * earlier pass has already processed are seeded (`OLD`) well before an
   * unrelated anchor row (`WATERMARK_AT`) that pins the watermark; "new" rows
   * use the default (now). Without this every row seeded in one test would
   * sit inside the overlap window and be re-read.
   */
  const WATERMARK_AT = new Date(Date.now() - 120 * minutes(1));
  const OLD = new Date(WATERMARK_AT.getTime() - 60 * minutes(1));

  function ticketPayload(id: number, subject: string, overrides: Record<string, unknown> = {}) {
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

  /** `fetchedAt` is settable so a test can model an out-of-order commit. */
  async function seed(providerEventId: string, payload: object, fetchedAt: Date = new Date()) {
    return prisma.rawEvent.create({
      data: { integrationId, providerEventId, sourceHash: providerEventId, payload, fetchedAt },
    });
  }

  const seedTicket = (id: number, subject: string, version = 1, fetchedAt?: Date, overrides = {}) =>
    seed(`ticket:${id}:v${version}`, ticketPayload(id, subject, overrides), fetchedAt);

  const seedAudit = (id: number, ticketId: number, fetchedAt?: Date) =>
    seed(
      `ticket_audit:${id}`,
      {
        id,
        ticket_id: ticketId,
        created_at: "2026-09-01T10:00:00Z",
        author_id: AGENT,
        via: { channel: "web" },
        events: [{ id: id * 10, type: "Comment", public: true, body: "hi", author_id: AGENT }],
      },
      fetchedAt,
    );

  const incremental = () => normalizeZendesk(prisma, integrationId, { mode: "incremental" });
  const full = () => normalizeZendesk(prisma, integrationId, { mode: "full" });
  const caseFor = (externalId: string) =>
    prisma.case.findFirstOrThrow({ where: { organizationId, externalId } });
  const integration = () => prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });

  it("does a full pass on the first run and records the watermark", async () => {
    await seedTicket(1, "A", 1, OLD);
    await seedTicket(2, "B", 1, OLD);
    expect((await integration()).normalizedThroughFetchedAt).toBeNull();

    const result = await incremental();

    expect(result.casesUpserted).toBe(2);
    const after = await integration();
    expect(after.normalizedThroughFetchedAt).not.toBeNull();
    expect(after.normalizedThroughId).not.toBeNull();
  });

  it("names each case by the integration that created it (N1.15)", async () => {
    await seedTicket(1, "A", 1, OLD);
    await incremental();
    await full();

    expect((await caseFor("1")).sourceIntegrationId).toBe(integrationId);
    expect(
      await prisma.case.findUnique({
        where: {
          organizationId_sourceIntegrationId_externalId: { organizationId, sourceIntegrationId: integrationId, externalId: "1" },
        },
      }),
    ).not.toBeNull();
  });

  it("re-derives only the ticket with a new snapshot, leaving the others untouched", async () => {
    await seedTicket(1, "A", 1, OLD);
    await seedTicket(2, "B", 1, OLD);
    await incremental();
    // A sentinel only a re-derivation of ticket 2 would overwrite.
    await prisma.case.update({ where: { id: (await caseFor("2")).id }, data: { subject: "SENTINEL" } });

    await seedTicket(1, "A renamed", 2);
    const result = await incremental();

    expect(result.casesUpserted).toBe(1);
    expect((await caseFor("1")).subject).toBe("A renamed");
    expect((await caseFor("2")).subject).toBe("SENTINEL");

    // The full pass is the backstop: it restores ticket 2.
    await full();
    expect((await caseFor("2")).subject).toBe("B");
  });

  it("re-derives a ticket that only received a new audit", async () => {
    await seedTicket(1, "A", 1, OLD);
    await seedTicket(2, "B", 1, OLD);
    await incremental();
    const before = await prisma.normalizedEvent.count({ where: { caseId: (await caseFor("1")).id } });

    await seedAudit(500, 1);
    const result = await incremental();

    expect(result.casesUpserted).toBe(1);
    expect(await prisma.normalizedEvent.count({ where: { caseId: (await caseFor("1")).id } })).toBeGreaterThan(before);
  });

  it("refreshes tickets of an organization whose snapshot changed", async () => {
    await seed("organization:7:v1", { id: 7, name: "Acme" }, OLD);
    await seedTicket(1, "A", 1, OLD, { organization_id: 7 });
    await seedTicket(2, "B", 1, OLD);
    await incremental();
    const customerId = (await caseFor("1")).customerId;
    expect(customerId).not.toBeNull();

    await seed("organization:7:v2", { id: 7, name: "Acme Renamed" });
    const result = await incremental();

    expect(result.casesUpserted).toBe(1); // ticket 1 only — ticket 2 has no organization
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId! } })).name).toBe("Acme Renamed");
  });

  it("falls back to a full pass when the changed rows include a user role snapshot", async () => {
    await seedTicket(1, "A", 1, OLD);
    await seedTicket(2, "B", 1, OLD);
    await incremental();
    await prisma.case.update({ where: { id: (await caseFor("2")).id }, data: { subject: "SENTINEL" } });

    await seed(`user:${AGENT}:v1`, { id: AGENT, role: "agent" });
    const result = await incremental();

    expect(result.casesUpserted).toBe(2);
    expect((await caseFor("2")).subject).toBe("B");
  });

  it("picks up a row that committed behind the watermark, within the overlap window", async () => {
    await seedTicket(1, "A", 1, OLD);
    await seedTicket(2, "B", 1, OLD);
    await incremental();
    const watermark = (await integration()).normalizedThroughFetchedAt!;

    // Out-of-order commit: its fetchedAt is *older* than the watermark, but
    // it only became visible now.
    await seedTicket(2, "B renamed", 2, new Date(watermark.getTime() - minutes(5)));
    const result = await incremental();

    expect(result.casesUpserted).toBe(1);
    expect((await caseFor("2")).subject).toBe("B renamed");
  });

  it("leaves a row older than the overlap window to the full pass", async () => {
    await seedTicket(1, "A", 1, OLD);
    await incremental();
    const watermark = (await integration()).normalizedThroughFetchedAt!;

    await seedTicket(1, "A renamed", 2, new Date(watermark.getTime() - zendesk.NORMALIZATION_OVERLAP_MS - minutes(5)));
    const result = await incremental();

    expect(result.casesUpserted).toBe(0);
    expect((await caseFor("1")).subject).toBe("A");

    await full();
    expect((await caseFor("1")).subject).toBe("A renamed");
  });

  it("soft-deletes a case the source reports gone, though no snapshot or audit of it changed", async () => {
    await seedTicket(1, "A", 1, OLD);
    await incremental();
    expect((await caseFor("1")).deletedAt).toBeNull();

    // The incremental export reports the ticket deleted: ingestion records it, normalization applies it.
    await seed("ticket_deleted:1:h", { ticketId: 1 });
    await incremental();

    expect((await caseFor("1")).deletedAt).not.toBeNull();
  });

  it("does nothing when nothing changed, and an unchanged ticket keeps its event rows", async () => {
    await seedTicket(1, "A", 1, OLD);
    await seedAudit(500, 1, OLD);
    await incremental();
    const caseId = (await caseFor("1")).id;
    const before = await prisma.normalizedEvent.findMany({ where: { caseId }, orderBy: { id: "asc" } });
    expect(before.length).toBeGreaterThan(0);

    expect((await incremental()).casesUpserted).toBe(0);
    // Even a full re-derivation writes no event: same ids, same createdAt.
    await full();
    const after = await prisma.normalizedEvent.findMany({ where: { caseId }, orderBy: { id: "asc" } });
    expect(after.map((e) => [e.id, e.createdAt.getTime()])).toEqual(before.map((e) => [e.id, e.createdAt.getTime()]));
  });

  it("replaces events that actually changed, and only those", async () => {
    await seedTicket(1, "A", 1, OLD);
    await seedAudit(500, 1, OLD);
    await incremental();
    const caseId = (await caseFor("1")).id;
    const before = await prisma.normalizedEvent.findMany({ where: { caseId } });

    await seedAudit(501, 1);
    await incremental();
    const after = await prisma.normalizedEvent.findMany({ where: { caseId } });

    // Every earlier event survives with its id; the new audit's events are added.
    const afterIds = new Set(after.map((e) => e.id));
    for (const row of before) expect(afterIds.has(row.id)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it("a ticket-scoped (webhook) run never moves the watermark", async () => {
    await seedTicket(1, "A", 1, OLD);
    await incremental();
    const before = await integration();

    await seedTicket(1, "A webhook", 2);
    await normalizeZendesk(prisma, integrationId, { ticketIds: [1] });

    const after = await integration();
    expect(after.normalizedThroughFetchedAt).toEqual(before.normalizedThroughFetchedAt);
    expect(after.normalizedThroughId).toEqual(before.normalizedThroughId);
  });

  it("a full-mode run also advances the watermark", async () => {
    await seedTicket(1, "A", 1, OLD);
    await full();
    expect((await integration()).normalizedThroughFetchedAt).not.toBeNull();
  });
});
