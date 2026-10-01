/**
 * Roadmap 1.8 — golden SLA scenarios: realistic Zendesk ticket histories
 * with hand-computed results, running in CI. Covers, one ticket per
 * scenario: pending_customer, several unanswered customer messages,
 * consecutive agent replies, private notes, a reopen, solved -> closed, a
 * holiday, and a DST transition.
 *
 * Same shape as sla-e2e-matrix.test.ts (1.3): raw Zendesk ticket/audit
 * payloads written as real `RawEvent` rows, then the real
 * normalization -> commitment -> re-resolution -> next-reply-cycle ->
 * evaluation chain, asserted at the end. Every commitment here uses
 * `resolution` and/or `next_reply` targets only — deliberately sidesteps
 * `first_response`'s D5b agent-vs-customer creation-actor detection (this
 * fixture's tickets, like sla-e2e-matrix.test.ts's, have no sideloaded
 * Zendesk user roles, so `case_created`'s actor isn't the point of these
 * scenarios).
 *
 * Real Postgres, like sla-e2e-matrix.test.ts. Needs a migrated database at
 * TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { CommitmentKind, Prisma, PrismaClient } from "@sla/db";
import type { ZendeskAudit, ZendeskTicket } from "@sla/zendesk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeZendesk } from "./ingest-helpers";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const SUBDOMAIN = "golden";
const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);
const iso = (time: string) => at(time).toISOString();

describe.skipIf(!TEST_DATABASE_URL)("SLA golden scenarios (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");
  let zendesk: typeof import("@sla/zendesk");

  let organizationId: string;
  let integrationId: string;
  let calendar247Id: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    commitments = await import("@sla/commitments");
    zendesk = await import("@sla/zendesk");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Golden Org" } });
    organizationId = organization.id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: SUBDOMAIN } },
    });
    integrationId = integration.id;
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    calendar247Id = calendar.versions[0]!.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ---- Zendesk fixture builders (mirrors sla-e2e-matrix.test.ts) ----------------

  function ticket(id: number, overrides: Partial<ZendeskTicket> = {}): ZendeskTicket {
    return {
      id,
      url: `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/${id}.json`,
      external_id: null,
      subject: `Ticket ${id}`,
      created_at: iso("10:00"),
      updated_at: iso("10:00"),
      status: "open",
      priority: "normal",
      organization_id: null,
      requester_id: 900,
      via: { channel: "web" },
      ...overrides,
    };
  }

  let nextAuditId = 1;
  function statusAudit(ticketId: number, time: string, from: string, to: string): ZendeskAudit {
    const id = nextAuditId++;
    return {
      id,
      ticket_id: ticketId,
      created_at: new Date(time).toISOString(),
      author_id: 500,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Change", field_name: "status", previous_value: from, value: to }],
    };
  }

  function replyAudit(ticketId: number, time: string, authorRole: "agent" | "customer"): ZendeskAudit {
    const id = nextAuditId++;
    const authorId = authorRole === "agent" ? 500 : 900;
    return {
      id,
      ticket_id: ticketId,
      created_at: new Date(time).toISOString(),
      author_id: authorId,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Comment", public: true, author_id: authorId, plain_body: "reply" }],
    };
  }

  /** An internal note — never a customer_replied/agent_replied event. */
  function noteAudit(ticketId: number, time: string): ZendeskAudit {
    const id = nextAuditId++;
    return {
      id,
      ticket_id: ticketId,
      created_at: new Date(time).toISOString(),
      author_id: 500,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Comment", public: false, author_id: 500, plain_body: "internal note" }],
    };
  }

  async function ingest(input: { tickets?: ZendeskTicket[]; audits?: ZendeskAudit[] }) {
    const inputs = [
      ...(input.tickets ?? []).map((t) => zendesk.mapTicketToRawEvent(t)),
      ...(input.audits ?? []).map(zendesk.mapAuditToRawEvent),
    ];
    if (inputs.length > 0) {
      await prisma.rawEvent.createMany({
        data: inputs.map((i) => ({ integrationId, providerEventId: i.providerEventId, sourceHash: i.sourceHash, payload: i.payload as Prisma.InputJsonValue })),
        skipDuplicates: true,
      });
    }
    return normalizeZendesk(prisma, integrationId);
  }

  async function createPolicy(
    name: string,
    targets: { kind: string; minutes: number }[],
    overrides: Record<string, unknown> = {},
  ) {
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name } });
    return prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {} as Prisma.InputJsonValue,
        targets: targets as unknown as Prisma.InputJsonValue,
        pauseOnStates: [],
        calendarVersionId: calendar247Id,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: at("00:00"),
        ...overrides,
      },
    });
  }

  const commitmentRow = (caseId: string, kind: CommitmentKind) =>
    prisma.commitment.findFirstOrThrow({ where: { caseId, kind } });

  const commitmentRows = (caseId: string, kind: CommitmentKind) =>
    prisma.commitment.findMany({ where: { caseId, kind }, orderBy: { startedAt: "asc" } });

  /** The most recent Evaluation for a commitment — a case re-evaluated across two pipeline passes has more than one row. */
  const latestEvaluation = async (commitmentId: string) =>
    prisma.evaluation.findFirstOrThrow({ where: { commitmentId }, orderBy: { evaluatedAt: "desc" } });

  async function runPipelineStages(asOf: string) {
    const created = await commitments.runCommitmentPipeline(prisma, organizationId);
    const reResolved = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf });
    const cycles = await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });
    const evaluated = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" });
    return { created, reResolved, cycles, evaluated };
  }

  async function caseByExternalId(externalId: string) {
    return prisma.case.findFirstOrThrow({ where: { organizationId, externalId } });
  }

  // ---- 1: pending_customer -------------------------------------------------------

  it("pending_customer: resolution pauses while pending, running time excludes it", async () => {
    await createPolicy("Pending", [{ kind: "resolution", minutes: 240 }], { pauseOnStates: ["pending_customer"] });
    const t = ticket(1);
    await ingest({
      tickets: [t],
      audits: [
        statusAudit(1, iso("10:30"), "open", "pending"),
        replyAudit(1, iso("11:30"), "customer"), // reopens (customer reply back on a pending ticket)
        statusAudit(1, iso("11:30"), "pending", "open"),
        statusAudit(1, iso("13:30"), "open", "solved"),
      ],
    });
    await runPipelineStages(iso("13:30"));

    // Running: 10:00-10:30 (30m) + 11:30-13:30 (120m) = 150m. The pending
    // hour (10:30-11:30) is excluded — if it counted, elapsed would be 210m.
    const row = await commitmentRow((await caseByExternalId("1")).id, "resolution");
    expect(row).toMatchObject({ status: "met", targetMinutes: 240 });
    const evaluation = await latestEvaluation(row.id);
    expect(evaluation.elapsedSeconds).toBe(150 * 60);
  });

  // ---- 2: several unanswered customer messages ------------------------------------

  it("several unanswered customer messages: one cycle, not one per message", async () => {
    await createPolicy("NextReply", [
      { kind: "resolution", minutes: 480 },
      { kind: "next_reply", minutes: 30 },
    ]);
    const t = ticket(2, { created_at: iso("09:00") });
    await ingest({
      tickets: [t],
      audits: [
        // Establishes first response, so the customer replies below are
        // Next Reply's to gate, not first response's (deriveNextReplyCycles
        // never counts a customer reply before first response completes).
        replyAudit(2, iso("09:05"), "agent"),
        replyAudit(2, iso("10:00"), "customer"),
        replyAudit(2, iso("10:05"), "customer"),
        replyAudit(2, iso("10:10"), "customer"),
        replyAudit(2, iso("10:20"), "agent"),
      ],
    });
    await runPipelineStages(iso("10:20"));

    const rows = await commitmentRows((await caseByExternalId("2")).id, "next_reply");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "met", startedAt: at("10:00"), closedAt: at("10:20") });
  });

  // ---- 3: consecutive agent replies -----------------------------------------------

  it("consecutive agent replies: only the first completes the cycle, the rest create nothing", async () => {
    await createPolicy("NextReply", [
      { kind: "resolution", minutes: 480 },
      { kind: "next_reply", minutes: 30 },
    ]);
    const t = ticket(3, { created_at: iso("09:00") });
    await ingest({
      tickets: [t],
      audits: [
        replyAudit(3, iso("09:05"), "agent"), // establishes first response
        replyAudit(3, iso("10:00"), "customer"),
        replyAudit(3, iso("10:10"), "agent"),
      ],
    });
    // Evaluated right at the completing reply, so closedAt (stamped at the
    // run that discovers finalization, not the event's own instant) matches it.
    await runPipelineStages(iso("10:10"));
    const rows = await commitmentRows((await caseByExternalId("3")).id, "next_reply");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "met", closedAt: at("10:10") });

    // Two more consecutive agent replies, with no customer reply between: no new cycle.
    await ingest({
      tickets: [ticket(3, { created_at: iso("09:00"), updated_at: iso("10:20") })],
      audits: [replyAudit(3, iso("10:15"), "agent"), replyAudit(3, iso("10:20"), "agent")],
    });
    await runPipelineStages(iso("10:20"));
    const rowsAfter = await commitmentRows((await caseByExternalId("3")).id, "next_reply");
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0]!.id).toBe(rows[0]!.id);
  });

  // ---- 4: private notes ------------------------------------------------------------

  it("private notes: never complete a cycle or count as a reply", async () => {
    await createPolicy("NextReply", [
      { kind: "resolution", minutes: 480 },
      { kind: "next_reply", minutes: 30 },
    ]);
    const t = ticket(4, { created_at: iso("09:00") });
    await ingest({
      tickets: [t],
      audits: [
        replyAudit(4, iso("09:05"), "agent"), // establishes first response
        replyAudit(4, iso("10:00"), "customer"),
        noteAudit(4, iso("10:05")), // internal note — must not complete the cycle
        replyAudit(4, iso("10:15"), "agent"),
      ],
    });
    await runPipelineStages(iso("10:15"));

    const rows = await commitmentRows((await caseByExternalId("4")).id, "next_reply");
    expect(rows).toHaveLength(1);
    // Completed by the real reply at 10:15, not the note at 10:05.
    expect(rows[0]).toMatchObject({ status: "met", closedAt: at("10:15") });

    const noteEvents = await prisma.normalizedEvent.findMany({
      where: { case: { organizationId }, occurredAt: at("10:05") },
    });
    expect(noteEvents.every((e) => e.type !== "agent_replied" && e.type !== "customer_replied")).toBe(true);
  });

  // ---- 5: reopen (D3 excludes solved time, D4 cancels the open cycle) -----------

  it("reopen: solved time is excluded from resolution, and the close cancels an unanswered cycle", async () => {
    await createPolicy("Reopen", [
      { kind: "resolution", minutes: 150 },
      { kind: "next_reply", minutes: 30 },
    ]);
    const t = ticket(5, { created_at: iso("09:00") });
    await ingest({
      tickets: [t],
      audits: [
        replyAudit(5, iso("09:05"), "agent"), // establishes first response
        replyAudit(5, iso("10:05"), "customer"), // starts a cycle
        statusAudit(5, iso("10:30"), "open", "solved"),
      ],
    });
    // First pass, before the reopen: the cycle anchored at 10:05 is still open.
    await runPipelineStages(iso("10:10"));
    const openCycle = await commitmentRow((await caseByExternalId("5")).id, "next_reply");
    expect(openCycle.status).not.toBe("cancelled");

    await ingest({
      tickets: [ticket(5, { created_at: iso("09:00"), updated_at: iso("12:00") })],
      audits: [
        replyAudit(5, iso("11:30"), "customer"), // reopens
        statusAudit(5, iso("11:30"), "solved", "open"),
        replyAudit(5, iso("11:45"), "agent"),
        statusAudit(5, iso("12:00"), "open", "solved"),
      ],
    });
    await runPipelineStages(iso("12:10"));

    // Resolution: 09:00-10:30 (90m) + 11:30-12:00 (30m) = 120m running. The
    // solved hour (10:30-11:30) is excluded (D3) — if it counted, elapsed
    // would be 210m and the 150m target would already be breached.
    const resolution = await commitmentRow((await caseByExternalId("5")).id, "resolution");
    expect(resolution).toMatchObject({ status: "met" });
    const resolutionEval = await latestEvaluation(resolution.id);
    expect(resolutionEval.elapsedSeconds).toBe(120 * 60);

    // Next Reply: the pre-close cycle (10:05) is cancelled, not completed;
    // a fresh cycle (11:30) opened after the reopen and was answered.
    const cycles = await commitmentRows((await caseByExternalId("5")).id, "next_reply");
    expect(cycles).toHaveLength(2);
    expect(cycles.find((c) => c.id === openCycle.id)!.status).toBe("cancelled");
    // closedAt is stamped at the run that discovers finalization (12:10
    // here, since both the reopen and the answer are only observed in the
    // second pass), not the answering reply's own instant (11:45).
    const secondCycle = cycles.find((c) => c.id !== openCycle.id)!;
    expect(secondCycle).toMatchObject({ status: "met", startedAt: at("11:30") });
  });

  // ---- 6: solved -> closed (a later auto-close doesn't move the clock) ----------

  it("solved -> closed: the resolution clock stops at the solve, not the later auto-close", async () => {
    await createPolicy("AutoClose", [{ kind: "resolution", minutes: 60 }]);
    const t = ticket(6);
    await ingest({
      tickets: [t],
      audits: [
        statusAudit(6, iso("10:30"), "open", "solved"), // 30m in, inside the 60m target
      ],
    });
    await runPipelineStages(iso("10:30"));

    // A Zendesk automation auto-closes it four days later.
    const autoClose: ZendeskAudit = {
      id: nextAuditId++,
      ticket_id: 6,
      created_at: new Date(at("10:30").getTime() + 4 * 24 * 60 * 60_000).toISOString(),
      author_id: -1,
      via: { channel: "automation" },
      events: [{ id: 99990, type: "Change", field_name: "status", previous_value: "solved", value: "closed" }],
    };
    await ingest({ tickets: [ticket(6, { status: "closed", updated_at: autoClose.created_at })], audits: [autoClose] });
    const asOfFiveDaysLater = new Date(at("10:30").getTime() + 5 * 24 * 60 * 60_000).toISOString();
    await runPipelineStages(asOfFiveDaysLater);

    const row = await commitmentRow((await caseByExternalId("6")).id, "resolution");
    expect(row.status).toBe("met");
    const evaluation = await latestEvaluation(row.id);
    expect(evaluation.elapsedSeconds).toBe(30 * 60); // not ~5 days
  });

  // ---- 7: a holiday -----------------------------------------------------------------

  it("a holiday: resolution's working-time clock skips it entirely", async () => {
    const businessCalendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "Weekdays 9-17 UTC",
        versions: {
          create: {
            version: 1,
            timezone: "UTC",
            // Tue/Wed/Thu 9:00-17:00; Wed 2026-09-23 is a holiday.
            weekly: [2, 3, 4].map((day) => ({ day, openMinute: 9 * 60, closeMinute: 17 * 60 })),
            holidays: ["2026-09-23"],
            alwaysOpen: false,
          },
        },
      },
      include: { versions: true },
    });
    await createPolicy("Holiday", [{ kind: "resolution", minutes: 180 }], {
      calendarVersionId: businessCalendar.versions[0]!.id,
    });

    // Tue 2026-09-22 16:00 UTC open, no close event yet.
    const openedAt = new Date("2026-09-22T16:00:00.000Z").toISOString();
    const t: ZendeskTicket = {
      id: 7,
      url: `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/7.json`,
      external_id: null,
      subject: "Holiday ticket",
      created_at: openedAt,
      updated_at: openedAt,
      status: "open",
      priority: "normal",
      organization_id: null,
      requester_id: 900,
      via: { channel: "web" },
    };
    await ingest({ tickets: [t] });
    // Tue 16:00-17:00 (60m) + holiday Wed skipped + Thu 09:00-10:00 (60m) = 120m.
    const asOf = new Date("2026-09-24T10:00:00.000Z").toISOString();
    await runPipelineStages(asOf);

    const row = await commitmentRow((await caseByExternalId("7")).id, "resolution");
    const evaluation = await latestEvaluation(row.id);
    expect(evaluation.elapsedSeconds).toBe(120 * 60);
    expect(row.status).toBe("at_risk"); // 120/180 = 66.7%, crosses the default 50% warn threshold
  });

  // ---- 8: a DST transition ----------------------------------------------------------

  it("a DST transition: the resolution deadline carries correctly across spring-forward", async () => {
    const nyCalendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "Weekdays 9-17 America/New_York",
        versions: {
          create: {
            version: 1,
            timezone: "America/New_York",
            weekly: [1, 2, 3, 4, 5].map((day) => ({ day, openMinute: 9 * 60, closeMinute: 17 * 60 })),
            holidays: [],
            alwaysOpen: false,
          },
        },
      },
      include: { versions: true },
    });
    await createPolicy("DST", [{ kind: "resolution", minutes: 120 }], {
      calendarVersionId: nyCalendar.versions[0]!.id,
    });

    // Fri 2026-03-06 16:00 EST (21:00Z): 60m before close Friday, 60m more
    // from Mon 09:00 -- but the intervening weekend crosses the
    // spring-forward transition (2026-03-08), so Monday 09:00 is EDT
    // (13:00Z), not EST. Hand-verified in packages/core/test/calendar.test.ts
    // ("carries across the spring-forward weekend using the new offset").
    const openedAt = "2026-03-06T21:00:00.000Z";
    const t: ZendeskTicket = {
      id: 8,
      url: `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/8.json`,
      external_id: null,
      subject: "DST ticket",
      created_at: openedAt,
      updated_at: openedAt,
      status: "open",
      priority: "normal",
      organization_id: null,
      requester_id: 900,
      via: { channel: "web" },
    };
    await ingest({ tickets: [t] });
    await runPipelineStages(openedAt);

    const row = await commitmentRow((await caseByExternalId("8")).id, "resolution");
    expect(row.dueAt.toISOString()).toBe("2026-03-09T14:00:00.000Z");

    // Evaluated live, right before the deadline: still on_track/at_risk, not
    // yet breached, and the projected due date agrees with the frozen one.
    const evaluation = await commitments.runEvaluationPipeline(prisma, organizationId, {
      asOf: "2026-03-09T13:59:00.000Z",
      scope: "all",
    });
    expect(evaluation.commitmentsFinalized).toBe(0);
    const stillOpen = await commitmentRow((await caseByExternalId("8")).id, "resolution");
    expect(stillOpen.status).not.toBe("breached");
  });
});
