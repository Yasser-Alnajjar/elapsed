/**
 * Intercom ticket "Waiting on customer" -> `pending_customer` -> native SLA
 * pause, end to end: raw Intercom payloads (shaped like real GET /conversations
 * and GET /tickets responses, Intercom-Version 2.11) through the real
 * normalization, projection, commitment and evaluation pipelines.
 *
 * Intercom keeps "Waiting on customer" on the *ticket*, not the conversation:
 * the conversation stays `open`, its `ticket_state_updated_by_admin` part names
 * no state, and the state it moved to is on the ticket API's part of the same
 * id. Before this was read, every such case stayed `open` ("with Support").
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeIntegration } from "./ingest-helpers";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const T = 1_790_000_000; // case created, epoch seconds
const at = (offset: number) => new Date((T + offset) * 1000);
const iso = (offset: number) => at(offset).toISOString();

describe.skipIf(!TEST_DATABASE_URL)("Intercom Waiting on customer pauses the SLA clock (real Postgres)", () => {
  let prisma: PrismaClient;
  let intercom: typeof import("@sla/intercom");
  let commitments: typeof import("@sla/commitments");
  let organizationId: string;
  let integrationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    intercom = await import("@sla/intercom");
    commitments = await import("@sla/commitments");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    organizationId = (await prisma.organization.create({ data: { name: "Intercom Waiting Org" } })).id;
    integrationId = (await prisma.integration.create({ data: { organizationId, provider: "intercom", credentials: {} } })).id;
    await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
    });
    await commitments.createNativePolicy(prisma, organizationId, "Native high", {
      match: { priority: ["high"] },
      targets: [{ kind: "resolution", minutes: 60 }],
      warnAtPercent: [50, 80, 95],
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const conversation = (state: "open" | "closed", ticketState: string, updatedAt: number) => ({
    id: "c1",
    created_at: T,
    updated_at: T + updatedAt,
    state,
    priority: "priority",
    source: { type: "email", subject: "Cannot log in", author: { type: "user", id: "u1" } },
    contacts: { contacts: [{ id: "p1", type: "contact" }] },
    ticket: { id: "c1", type: "ticket", state: ticketState },
  });
  const statePart = (id: string, offset: number) => ({
    id,
    part_type: "ticket_state_updated_by_admin",
    created_at: T + offset,
    body: null,
    author: { type: "admin", id: "a1", name: "Agent" },
  });
  const closePart = (id: string, offset: number) => ({
    id,
    part_type: "close",
    created_at: T + offset,
    body: null,
    author: { type: "admin", id: "a1", name: "Agent" },
  });
  const ticketPart = (id: string, offset: number, previous: string, state: string) => ({
    ...statePart(id, offset),
    previous_ticket_state: previous,
    ticket_state: state,
  });

  async function seed(inputs: { providerEventId: string; sourceHash: string; payload: unknown }[], fetchedAt?: Date) {
    for (const input of inputs) {
      await prisma.rawEvent.create({
        data: { integrationId, providerEventId: input.providerEventId, sourceHash: input.sourceHash, payload: input.payload as object, ...(fetchedAt ? { fetchedAt } : {}) },
      });
    }
  }
  /** One backfill's worth of rows for conversation c1: snapshot, its parts, and (when given) the ticket API's state parts. */
  const ingest = (
    conv: ReturnType<typeof conversation>,
    parts: { id: string; part_type: string; created_at: number }[],
    ticketParts: ReturnType<typeof ticketPart>[] = [],
    fetchedAt?: Date,
  ) =>
    seed(
      [
        intercom.mapConversationToRawEvent(conv),
        ...parts.map((p) => intercom.mapConversationPartToRawEvent("c1", p)),
        ...ticketParts.map((p) => intercom.mapTicketStatePartToRawEvent("c1", p)),
      ],
      fetchedAt,
    );

  async function run(asOfOffset: number) {
    const asOf = iso(asOfOffset);
    const result = await normalizeIntegration(prisma, integrationId);
    expect(result.failures).toEqual([]);
    await commitments.runCommitmentPipeline(prisma, organizationId);
    await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf });
    await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });
    await commitments.runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" });
  }

  async function stateEvents() {
    const c = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "c1" } });
    const rows = await prisma.normalizedEvent.findMany({
      where: { caseId: c.id, type: { in: ["state_changed", "case_closed"] } },
      orderBy: [{ occurredAt: "asc" }, { sourceSequence: "asc" }],
    });
    return rows.map((e) => [e.type, e.fromState, e.toState, e.occurredAt.toISOString(), e.system, e.sourceRole]);
  }

  async function resolution() {
    const c = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "c1" } });
    const row = await prisma.commitment.findFirstOrThrow({ where: { caseId: c.id, kind: "resolution" } });
    const evaluation = await prisma.evaluation.findFirstOrThrow({ where: { commitmentId: row.id }, orderBy: { evaluatedAt: "desc" } });
    return { row, evaluation };
  }

  // Support 0-600 s -> Waiting on customer 600-1800 s -> Support 1800 s -> resolved 3000 s.
  const submittedToInProgress = ticketPart("t0", 100, "submitted", "in_progress");
  const toWaiting = ticketPart("t1", 600, "in_progress", "waiting_on_customer");
  const backToSupport = ticketPart("t2", 1800, "waiting_on_customer", "in_progress");
  const resolved = ticketPart("t3", 3000, "in_progress", "resolved");

  it("Support -> Waiting on customer: normalizes to pending_customer and pauses the Resolution clock", async () => {
    await ingest(
      conversation("open", "waiting_on_customer", 600),
      [statePart("t0", 100), statePart("t1", 600)],
      [submittedToInProgress, toWaiting],
    );
    await run(1200);

    expect(await stateEvents()).toEqual([["state_changed", "open", "pending_customer", iso(600), "intercom", "ticket_source"]]);
    const { row, evaluation } = await resolution();
    expect(row.status).toBe("on_track");
    expect(evaluation.elapsedSeconds).toBe(600); // 0-600 s ran; 600-1200 s is paused
  });

  it("Waiting on customer -> Support: normalizes back to open and resumes the clock", async () => {
    await ingest(
      conversation("open", "in_progress", 1800),
      [statePart("t0", 100), statePart("t1", 600), statePart("t2", 1800)],
      [submittedToInProgress, toWaiting, backToSupport],
    );
    await run(2400);

    expect(await stateEvents()).toEqual([
      ["state_changed", "open", "pending_customer", iso(600), "intercom", "ticket_source"],
      ["state_changed", "pending_customer", "open", iso(1800), "intercom", "ticket_source"],
    ]);
    const { evaluation } = await resolution();
    expect(evaluation.elapsedSeconds).toBe(1200); // 0-600 s and 1800-2400 s; the 1200 s wait is excluded
  });

  it("resolving after a wait excludes the wait and stops the clock at the close", async () => {
    await ingest(
      conversation("closed", "resolved", 3000),
      [statePart("t0", 100), statePart("t1", 600), statePart("t2", 1800), statePart("t3", 3000), closePart("c1", 3000)],
      [submittedToInProgress, toWaiting, backToSupport, resolved],
    );
    await run(4000);

    expect((await stateEvents()).map(([type, from, to]) => `${type}:${from}>${to}`)).toEqual([
      "state_changed:open>pending_customer",
      "state_changed:pending_customer>open",
      "case_closed:open>resolved",
    ]);
    const { row, evaluation } = await resolution();
    expect(row.status).toBe("met");
    expect(evaluation.elapsedSeconds).toBe(1800); // 0-600 s + 1800-3000 s
  });

  it("repairs a case ingested before the ticket API was read: the snapshot's ticket.state resolves the latest change", async () => {
    // No ticket_part rows at all — what the database holds for every Intercom
    // ticket synced before this change.
    await ingest(conversation("open", "waiting_on_customer", 600), [statePart("t0", 100), statePart("t1", 600)]);
    await run(1200);

    expect(await stateEvents()).toEqual([["state_changed", "open", "pending_customer", iso(600), "intercom", "ticket_source"]]);
    expect((await resolution()).evaluation.elapsedSeconds).toBe(600);
  });

  it("replaces the fallback's events with the exact ones once the ticket parts arrive, and is idempotent", async () => {
    await ingest(conversation("open", "in_progress", 1800), [statePart("t0", 100), statePart("t1", 600), statePart("t2", 1800)]);
    await run(2400);
    // Only the latest change (to in_progress) is resolvable without the ticket API: nothing was ever waiting.
    expect(await stateEvents()).toEqual([]);

    await seed([toWaiting, backToSupport, submittedToInProgress].map((p) => intercom.mapTicketStatePartToRawEvent("c1", p)));
    await run(2400);
    const exact = await stateEvents();
    expect(exact).toEqual([
      ["state_changed", "open", "pending_customer", iso(600), "intercom", "ticket_source"],
      ["state_changed", "pending_customer", "open", iso(1800), "intercom", "ticket_source"],
    ]);
    expect((await resolution()).evaluation.elapsedSeconds).toBe(1200);

    await run(2400);
    expect(await stateEvents()).toEqual(exact);
    expect(await prisma.normalizedEvent.count({ where: { type: "state_changed" } })).toBe(2);
  });
});
