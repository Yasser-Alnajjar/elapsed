/**
 * A case's first-response and resolution commitments through the real
 * commitment and evaluation pipelines: each finalizes on its own completion
 * event, a reopen un-finalizes only the one that is open again, and a kind
 * created later reuses its sibling's frozen policy and calendar versions.
 *
 * Real Postgres, like evaluation-persistence.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("multiple commitments per case (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");

  let organizationId: string;
  let caseId: string;
  let rawEventId: string;
  let calendarVersionId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    // @sla/db builds its connection from DATABASE_URL at import time.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    commitments = await import("@sla/commitments");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Multi Commitment Org" } });
    organizationId = organization.id;
    const zendesk = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    rawEventId = (
      await prisma.rawEvent.create({
        data: { integrationId: zendesk.id, providerEventId: "ticket:7", sourceHash: "h", payload: { id: 7 } },
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
    calendarVersionId = calendar.versions[0]!.id;
    caseId = (
      await prisma.case.create({
        data: { organizationId, externalId: "7", priority: "urgent", openedAt: at("10:00") },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createPolicy(name: string, version: number, overrides: Record<string, unknown> = {}) {
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name } });
    return prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version,
        match: {},
        targets: [
          { kind: "first_response", minutes: 120 },
          { kind: "resolution", minutes: 480 },
        ],
        pauseOnStates: ["pending_customer"],
        calendarVersionId,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: at("00:00"),
        ...overrides,
      },
    });
  }

  async function writeEvents(
    events: { time: string; type: string; toState?: string; actor?: string }[],
  ) {
    await prisma.normalizedEvent.deleteMany({ where: { caseId } });
    await prisma.normalizedEvent.createMany({
      data: events.map((e) => ({
        caseId,
        sourceRawEventId: rawEventId,
        type: e.type,
        occurredAt: at(e.time),
        actor: e.actor ?? "agent",
        system: "zendesk" as const,
        sourceRole: "ticket_source" as const,
        toState: e.toState ?? null,
      })),
    });
  }

  const byKind = async () =>
    Object.fromEntries(
      (await prisma.commitment.findMany({ where: { caseId } })).map((c) => [c.kind, c]),
    );

  it("finalizes first response at the agent reply while resolution keeps running, and a reopen only un-finalizes resolution", async () => {
    await createPolicy("Urgent", 1);
    await writeEvents([
      { time: "10:00", type: "case_created", toState: "new", actor: "customer" },
      { time: "10:30", type: "state_changed", toState: "pending_customer" },
      { time: "11:30", type: "state_changed", toState: "open", actor: "customer" },
      { time: "12:00", type: "agent_replied" },
    ]);
    expect((await commitments.runCommitmentPipeline(prisma, organizationId)).commitmentsCreated).toBe(2);

    await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("13:00").toISOString() });
    let rows = await byKind();
    expect(rows.first_response).toMatchObject({ status: "met", closedAt: at("13:00") });
    expect(rows.resolution).toMatchObject({ status: "on_track", closedAt: null });

    // Solved at 17:00: resolution finalizes; first response keeps its original closedAt.
    await writeEvents([
      { time: "10:00", type: "case_created", toState: "new", actor: "customer" },
      { time: "10:30", type: "state_changed", toState: "pending_customer" },
      { time: "11:30", type: "state_changed", toState: "open", actor: "customer" },
      { time: "12:00", type: "agent_replied" },
      { time: "17:00", type: "case_closed", toState: "resolved" },
    ]);
    await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("17:05").toISOString() });
    rows = await byKind();
    expect(rows.first_response).toMatchObject({ status: "met", closedAt: at("13:00") });
    expect(rows.resolution).toMatchObject({ status: "met", closedAt: at("17:05") });

    // Reopened at 18:00: only resolution is open again, and back in the active set.
    await writeEvents([
      { time: "10:00", type: "case_created", toState: "new", actor: "customer" },
      { time: "10:30", type: "state_changed", toState: "pending_customer" },
      { time: "11:30", type: "state_changed", toState: "open", actor: "customer" },
      { time: "12:00", type: "agent_replied" },
      { time: "17:00", type: "case_closed", toState: "resolved" },
      { time: "18:00", type: "state_changed", toState: "open", actor: "customer" },
    ]);
    await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("18:30").toISOString(), scope: "all" });
    rows = await byKind();
    expect(rows.first_response).toMatchObject({ status: "met", closedAt: at("13:00") });
    expect(rows.resolution).toMatchObject({ status: "at_risk", closedAt: null });

    const active = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("18:35").toISOString() });
    expect(active.commitmentsConsidered).toBe(1);
  });

  it("creates a missing kind under the sibling's frozen policy and calendar versions, not today's match", async () => {
    const original = await createPolicy("Urgent", 1);
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "first_response",
        policyVersionId: original.id,
        calendarVersionId,
        startedAt: at("10:00"),
        targetMinutes: 120,
        dueAt: at("12:00"),
      },
    });
    // A newer, more specific policy that would win a fresh match.
    await createPolicy("Urgent (strict)", 9, {
      match: { priority: ["urgent"] },
      targets: [
        { kind: "first_response", minutes: 30 },
        { kind: "resolution", minutes: 60 },
      ],
      pauseOnStates: [],
    });

    const result = await commitments.runCommitmentPipeline(prisma, organizationId);
    expect(result.commitmentsCreated).toBe(1);
    expect((await byKind()).resolution).toMatchObject({
      policyVersionId: original.id,
      calendarVersionId,
      targetMinutes: 480,
      startedAt: at("10:00"),
    });
  });

  it("falls back to the newest version of the same policy when the sibling's version had no target for the kind", async () => {
    const firstResponseOnly = await createPolicy("Urgent", 1, {
      targets: [{ kind: "first_response", minutes: 30 }],
    });
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "first_response",
        policyVersionId: firstResponseOnly.id,
        calendarVersionId,
        startedAt: at("10:00"),
        targetMinutes: 30,
        dueAt: at("10:30"),
      },
    });
    // Zendesk's resolution target is imported later, as a new version of the same policy.
    const withResolution = await prisma.sLAPolicyVersion.create({
      data: {
        policyId: firstResponseOnly.policyId,
        version: 2,
        match: {},
        targets: [
          { kind: "first_response", minutes: 30 },
          { kind: "resolution", minutes: 240 },
        ],
        pauseOnStates: ["pending_customer"],
        calendarVersionId,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: at("09:00"),
      },
    });
    // A different, more specific policy is never used for this case.
    await createPolicy("Urgent (strict)", 9, { match: { priority: ["urgent"] } });

    expect((await commitments.runCommitmentPipeline(prisma, organizationId)).commitmentsCreated).toBe(1);
    const rows = await byKind();
    expect(rows.first_response).toMatchObject({ policyVersionId: firstResponseOnly.id });
    expect(rows.resolution).toMatchObject({
      policyVersionId: withResolution.id,
      calendarVersionId,
      targetMinutes: 240,
      startedAt: at("10:00"),
    });
  });

  it("ignores a persisted Next Reply commitment when finishing a case's still-missing sibling kind", async () => {
    const original = await createPolicy("Urgent", 1);

    // Attached to no SLAPolicyVersion, so it's only ever loaded via the
    // missing-calendar-version prefetch — never via the policy-version load.
    const overrideCalendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "Enterprise 24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const overrideCalendarVersionId = overrideCalendar.versions[0]!.id;
    const customer = await prisma.customer.create({
      data: { organizationId, name: "Acme", calendarId: overrideCalendar.id },
    });
    await prisma.case.update({ where: { id: caseId }, data: { customerId: customer.id } });

    // The case's existing first-response commitment was created under the
    // customer's calendar override; a Next Reply commitment also exists on
    // the case. Before the fix, the unfiltered `commitments` relation counted
    // both toward `commitments.length < COMMITMENT_KINDS.length`, wrongly
    // skipping the calendar-version prefetch that this sibling's
    // `calendarVersionId` needs — resolution creation would fail with
    // "No BusinessCalendarVersion loaded".
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "first_response",
        policyVersionId: original.id,
        calendarVersionId: overrideCalendarVersionId,
        startedAt: at("10:00"),
        targetMinutes: 120,
        dueAt: at("12:00"),
      },
    });
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "next_reply",
        cycleKey: "next_reply:zendesk:raw_1:customer_replied:2026-09-17T11:00:00.000Z",
        policyVersionId: original.id,
        calendarVersionId,
        startedAt: at("11:00"),
        targetMinutes: 60,
        dueAt: at("12:00"),
      },
    });

    const result = await commitments.runCommitmentPipeline(prisma, organizationId);
    expect(result.casesFailed).toEqual([]);
    expect(result.commitmentsCreated).toBe(1);
    expect((await byKind()).resolution).toMatchObject({
      policyVersionId: original.id,
      calendarVersionId: overrideCalendarVersionId,
      targetMinutes: 480,
      startedAt: at("10:00"),
    });
  });

  describe("agent-created ticket, D5b clock delay", () => {
    it("creates first response on a later run once the customer replies, starting its clock there and ignoring the agent's earlier reply", async () => {
      await createPolicy("Urgent", 1);
      // Ticket opened by an agent (case #77): no customer has said anything
      // yet, so first response must not be created (D5b) — only resolution is.
      await writeEvents([
        { time: "10:00", type: "case_created", toState: "new", actor: "agent" },
        { time: "10:15", type: "agent_replied", actor: "agent" },
      ]);
      expect((await commitments.runCommitmentPipeline(prisma, organizationId)).commitmentsCreated).toBe(1);
      expect((await byKind()).first_response).toBeUndefined();

      // The customer's first message arrives. A later pipeline run must now
      // create first response, anchored at the customer's message — not at
      // ticket creation, and not retroactively satisfied by the 10:15 agent
      // reply that came before the customer ever asked for anything.
      await writeEvents([
        { time: "10:00", type: "case_created", toState: "new", actor: "agent" },
        { time: "10:15", type: "agent_replied", actor: "agent" },
        { time: "11:00", type: "customer_replied", actor: "customer" },
      ]);
      expect((await commitments.runCommitmentPipeline(prisma, organizationId)).commitmentsCreated).toBe(1);
      expect((await byKind()).first_response).toMatchObject({ startedAt: at("11:00") });

      // Still open and running just after the customer's message: the 10:15
      // agent reply must not have been read as already completing it.
      await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: at("11:15").toISOString(),
        scope: "all",
      });
      expect((await byKind()).first_response).toMatchObject({ status: "on_track", closedAt: null });

      // A genuine agent reply after the customer's message completes it normally.
      await writeEvents([
        { time: "10:00", type: "case_created", toState: "new", actor: "agent" },
        { time: "10:15", type: "agent_replied", actor: "agent" },
        { time: "11:00", type: "customer_replied", actor: "customer" },
        { time: "11:20", type: "agent_replied", actor: "agent" },
      ]);
      await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: at("11:25").toISOString(),
        scope: "all",
      });
      expect((await byKind()).first_response).toMatchObject({ status: "met", closedAt: at("11:25") });
    });

    it("never creates first response, and so never reports it met, when the agent replies but no customer ever does (D5)", async () => {
      await createPolicy("Urgent", 1);
      await writeEvents([
        { time: "10:00", type: "case_created", toState: "new", actor: "agent" },
        { time: "10:15", type: "agent_replied", actor: "agent" },
      ]);
      expect((await commitments.runCommitmentPipeline(prisma, organizationId)).commitmentsCreated).toBe(1);

      await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: at("12:00").toISOString(),
        scope: "all",
      });
      const rows = await byKind();
      expect(rows.first_response).toBeUndefined();
      expect(rows.resolution).toMatchObject({ status: "on_track", closedAt: null });
    });
  });
});
