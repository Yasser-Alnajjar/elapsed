/**
 * H-11 — the first-response clock must follow who *created* the ticket, and
 * that must not change as later audits arrive. Found by the H-4 spot check
 * against a real Zendesk sandbox: `case_created.actor` was taken from the
 * first status change, so an agent-submitted ticket was read as
 * customer-created at first ingest (a first-response clock opened at
 * creation, then a false breach at the reply-less close) and a
 * customer-submitted ticket an agent solved before the first sync was read as
 * agent-created (no first-response commitment at all).
 *
 * Real Postgres, same shape as sla-golden-scenarios.test.ts: raw ticket/audit
 * payloads -> real normalization -> real commitment pipeline. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { Prisma, PrismaClient } from "@sla/db";
import type { ZendeskAudit, ZendeskTicket } from "@sla/zendesk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const SUBDOMAIN = "h11";
const CUSTOMER = 900;
const AGENT = 500;
const at = (time: string) => new Date(`2026-09-28T${time}:00.000Z`);
const iso = (time: string) => at(time).toISOString();

describe.skipIf(!TEST_DATABASE_URL)("first-response creation actor (H-11, real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");
  let repair: typeof import("../../../packages/commitments/src/scripts/repair-first-response-start");
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
    commitments = await import("@sla/commitments");
    repair = await import("../../../packages/commitments/src/scripts/repair-first-response-start");
    zendesk = await import("@sla/zendesk");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    const organization = await prisma.organization.create({ data: { name: "H-11 Org" } });
    organizationId = organization.id;
    integrationId = (
      await prisma.integration.create({
        data: { organizationId, provider: "zendesk", credentials: { subdomain: SUBDOMAIN } },
      })
    ).id;
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "FR" } });
    await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {} as Prisma.InputJsonValue,
        targets: [
          { kind: "first_response", minutes: 10 },
          { kind: "resolution", minutes: 60 },
        ] as unknown as Prisma.InputJsonValue,
        pauseOnStates: [],
        calendarVersionId: calendar.versions[0]!.id,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: at("00:00"),
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ---- fixtures ---------------------------------------------------------------

  const ticket = (id: number, submitterId: number, overrides: Partial<ZendeskTicket> = {}): ZendeskTicket => ({
    id,
    url: `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/${id}.json`,
    external_id: null,
    subject: `Ticket ${id}`,
    created_at: iso("10:00"),
    updated_at: iso("10:00"),
    status: "open",
    priority: "normal",
    organization_id: null,
    requester_id: CUSTOMER,
    submitter_id: submitterId,
    via: { channel: "web" },
    ...overrides,
  });

  let nextAuditId = 1;
  // Zendesk's creation audit: Create events only, no status Change.
  function creationAudit(ticketId: number, authorId: number): ZendeskAudit {
    const id = nextAuditId++;
    return {
      id,
      ticket_id: ticketId,
      created_at: iso("10:00"),
      author_id: authorId,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Create", field_name: "priority", value: "normal" }],
    };
  }
  function solveAudit(ticketId: number, time: string, authorId = AGENT): ZendeskAudit {
    const id = nextAuditId++;
    return {
      id,
      ticket_id: ticketId,
      created_at: iso(time),
      author_id: authorId,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Change", field_name: "status", previous_value: "open", value: "solved" }],
    };
  }
  function customerReplyAudit(ticketId: number, time: string): ZendeskAudit {
    const id = nextAuditId++;
    return {
      id,
      ticket_id: ticketId,
      created_at: iso(time),
      author_id: CUSTOMER,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Comment", public: true, author_id: CUSTOMER, plain_body: "hello" }],
    };
  }

  async function ingest(input: { tickets?: ZendeskTicket[]; audits?: ZendeskAudit[] }) {
    const inputs = [
      ...(input.tickets ?? []).map((t) => zendesk.mapTicketToRawEvent(t)),
      ...(input.audits ?? []).map(zendesk.mapAuditToRawEvent),
    ];
    if (inputs.length > 0) {
      await prisma.rawEvent.createMany({
        data: inputs.map((i) => ({
          integrationId,
          providerEventId: i.providerEventId,
          sourceHash: i.sourceHash,
          payload: i.payload as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    }
    return zendesk.runZendeskNormalization(prisma, integrationId);
  }

  const runPipeline = () => commitments.runCommitmentPipeline(prisma, organizationId);
  const caseId = async (externalId: string) =>
    (await prisma.case.findUniqueOrThrow({ where: { organizationId_externalId: { organizationId, externalId } } })).id;
  const firstResponse = async (externalId: string) =>
    prisma.commitment.findMany({ where: { caseId: await caseId(externalId), kind: "first_response" } });
  const creatorOf = async (externalId: string) =>
    (
      await prisma.normalizedEvent.findFirstOrThrow({
        where: { caseId: await caseId(externalId), type: "case_created" },
      })
    ).actor;
  const eventSnapshot = async (externalId: string) =>
    (await prisma.normalizedEvent.findMany({ where: { caseId: await caseId(externalId) } }))
      .map((e) => ({ id: e.id, type: e.type, actor: e.actor, at: e.occurredAt.toISOString(), raw: e.sourceRawEventId }))
      .sort((a, b) => a.id.localeCompare(b.id));

  // ---- agent-created ticket (H-4 tickets 54-59) --------------------------------

  it("agent-submitted ticket: no first-response clock at first ingest, and none after the solve audit arrives", async () => {
    const t = ticket(54, AGENT);
    await ingest({ tickets: [t], audits: [creationAudit(54, AGENT)] });
    await runPipeline();
    expect(await creatorOf("54")).toBe("agent");
    expect(await firstResponse("54")).toHaveLength(0); // D5b: nothing to start on yet
    expect(await prisma.commitment.count({ where: { caseId: await caseId("54"), kind: "resolution" } })).toBe(1);

    // The solve arrives later — this is the event that used to flip the creator.
    await ingest({
      tickets: [ticket(54, AGENT, { status: "solved", updated_at: iso("10:20") })],
      audits: [solveAudit(54, "10:20")],
    });
    await runPipeline();
    expect(await creatorOf("54")).toBe("agent");
    expect(await firstResponse("54")).toHaveLength(0); // no false breach at the reply-less close
  });

  it("agent-submitted ticket: the first customer message still starts the first-response clock (D5b)", async () => {
    await ingest({ tickets: [ticket(55, AGENT)], audits: [creationAudit(55, AGENT), customerReplyAudit(55, "10:05")] });
    await runPipeline();
    const rows = await firstResponse("55");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startedAt).toEqual(at("10:05"));
  });

  // ---- customer-created ticket (H-4 ticket 1) ----------------------------------

  it("customer-submitted ticket solved by an agent before the first sync still gets its first-response commitment at creation", async () => {
    // Zendesk's sample ticket #1: submitter is the end user, yet the creation
    // audit is authored by an admin and an agent's solve is already present.
    await ingest({
      tickets: [ticket(1, CUSTOMER, { status: "solved", via: { channel: "email" }, updated_at: iso("10:23") })],
      audits: [creationAudit(1, AGENT), solveAudit(1, "10:23")],
    });
    await runPipeline();
    expect(await creatorOf("1")).toBe("customer");
    const rows = await firstResponse("1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startedAt: at("10:00"), targetMinutes: 10 });
  });

  it("customer-submitted ticket: creator and commitment are identical whether the agent's solve arrives before or after the first sync", async () => {
    await ingest({ tickets: [ticket(2, CUSTOMER)], audits: [creationAudit(2, CUSTOMER)] });
    await runPipeline();
    const before = await firstResponse("2");
    await ingest({
      tickets: [ticket(2, CUSTOMER, { status: "solved", updated_at: iso("10:30") })],
      audits: [solveAudit(2, "10:30")],
    });
    await runPipeline();
    const after = await firstResponse("2");
    expect(await creatorOf("2")).toBe("customer");
    expect(after.map((c) => [c.id, c.startedAt])).toEqual(before.map((c) => [c.id, c.startedAt]));
    expect(after).toHaveLength(1);
  });

  // ---- replay / idempotence ----------------------------------------------------

  it("re-normalizing (full and incremental) and re-running the pipeline changes nothing", async () => {
    await ingest({
      tickets: [ticket(54, AGENT, { status: "solved" }), ticket(1, CUSTOMER, { status: "solved" })],
      audits: [creationAudit(54, AGENT), solveAudit(54, "10:20"), creationAudit(1, AGENT), solveAudit(1, "10:23")],
    });
    await runPipeline();
    const snapshot = { a: await eventSnapshot("54"), b: await eventSnapshot("1") };
    const commitmentIds = (await prisma.commitment.findMany({ orderBy: { id: "asc" } })).map((c) => c.id);

    await zendesk.runZendeskNormalization(prisma, integrationId);
    await zendesk.runZendeskNormalization(prisma, integrationId, { mode: "incremental" });
    await ingest({}); // a third full replay
    const created = await runPipeline();

    expect({ a: await eventSnapshot("54"), b: await eventSnapshot("1") }).toEqual(snapshot);
    expect((await prisma.commitment.findMany({ orderBy: { id: "asc" } })).map((c) => c.id)).toEqual(commitmentIds);
    expect(JSON.stringify(created)).not.toMatch(/"first_response"/);
  });

  // ---- repair of rows written before the fix -----------------------------------

  it("repair removes a stale first-response commitment on an agent-submitted ticket, leaves correct ones, and is idempotent", async () => {
    await ingest({
      tickets: [ticket(54, AGENT, { status: "solved" }), ticket(1, CUSTOMER, { status: "solved" })],
      audits: [creationAudit(54, AGENT), solveAudit(54, "10:20"), creationAudit(1, AGENT), solveAudit(1, "10:23")],
    });
    await runPipeline();
    // Reproduce what the buggy code left behind on ticket 54: a clock opened at creation, breached at the close.
    const policyVersion = await prisma.sLAPolicyVersion.findFirstOrThrow();
    await prisma.commitment.create({
      data: {
        caseId: await caseId("54"),
        kind: "first_response",
        policyVersionId: policyVersion.id,
        calendarVersionId: policyVersion.calendarVersionId,
        startedAt: at("10:00"),
        targetMinutes: 10,
        dueAt: at("10:10"),
        status: "breached",
        closedAt: at("10:20"),
      },
    });
    const good = await firstResponse("1");

    const dry = await repair.repairFirstResponseStart(prisma, { organizationId });
    expect(dry).toMatchObject({ considered: 2, deleted: 0 });
    expect(dry.mismatched).toHaveLength(1);
    expect(dry.mismatched[0]).toMatchObject({ caseExternalId: "54", expectedStartedAt: null, status: "breached" });
    expect(await firstResponse("54")).toHaveLength(1); // dry run wrote nothing

    const applied = await repair.repairFirstResponseStart(prisma, { organizationId, apply: true });
    expect(applied.deleted).toBe(1);
    expect(await firstResponse("54")).toHaveLength(0);
    expect((await firstResponse("1")).map((c) => c.id)).toEqual(good.map((c) => c.id));

    await runPipeline(); // the pipeline must not bring the false commitment back
    expect(await firstResponse("54")).toHaveLength(0);
    expect((await repair.repairFirstResponseStart(prisma, { organizationId, apply: true })).mismatched).toEqual([]);
  });
});
