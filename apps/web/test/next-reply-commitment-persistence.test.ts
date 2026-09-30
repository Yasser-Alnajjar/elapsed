/**
 * Next Reply commitments persisted one per derived cycle: cycles derived from
 * real normalized events keep a stable row across re-runs, vanished cycles
 * are cancelled rather than deleted or duplicated, and the single-cycle kinds
 * still allow exactly one commitment per case.
 *
 * Real Postgres, like multi-commitment-pipeline.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import type { BusinessCalendarVersion, NormalizedEvent, SLAPolicyVersion } from "@sla/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("Next Reply commitment persistence (real Postgres)", () => {
  let prisma: PrismaClient;
  let core: typeof import("@sla/core");
  let commitments: typeof import("@sla/commitments");

  let caseId: string;
  let rawEventId: string;
  let policyVersion: SLAPolicyVersion;
  let calendarVersion: BusinessCalendarVersion;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    // @sla/db builds its connection from DATABASE_URL at import time.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    core = await import("@sla/core");
    commitments = await import("@sla/commitments");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organizationId = (await prisma.organization.create({ data: { name: "Next Reply Org" } })).id;
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
    const calendarRow = calendar.versions[0]!;
    calendarVersion = { id: calendarRow.id, version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true };
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Default" } });
    const policyRow = await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {},
        targets: [
          { kind: "first_response", minutes: 120 },
          { kind: "next_reply", minutes: 60 },
        ],
        pauseOnStates: ["pending_customer"],
        calendarVersionId: calendarRow.id,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: at("00:00"),
      },
    });
    policyVersion = {
      id: policyRow.id,
      policyId: policy.id,
      version: 1,
      match: {},
      targets: [
        { kind: "first_response", minutes: 120 },
        { kind: "next_reply", minutes: 60 },
      ],
      pauseOnStates: ["pending_customer"],
      calendarVersionId: calendarRow.id,
      warnAtPercent: [50, 80, 95],
      effectiveFrom: at("00:00").toISOString(),
    };
    caseId = (
      await prisma.case.create({ data: { organizationId, system: "zendesk", externalId: "7", openedAt: at("09:00") } })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Replaces the case's events (as renormalization does) and derives its cycles from the persisted rows. */
  async function deriveFromPersisted(events: { time: string; type: string; sequence: number }[], asOf: string) {
    await prisma.normalizedEvent.deleteMany({ where: { caseId } });
    await prisma.normalizedEvent.createMany({
      data: events.map((e) => ({
        caseId,
        sourceRawEventId: rawEventId,
        type: e.type,
        occurredAt: at(e.time),
        actor: e.type === "customer_replied" || e.type === "case_created" ? "customer" : "agent",
        system: "zendesk" as const,
        sourceRole: "ticket_source" as const,
        sourceSequence: e.sequence,
      })),
    });
    const rows = await prisma.normalizedEvent.findMany({
      where: { caseId },
      orderBy: [{ occurredAt: "asc" }, { sourceSequence: "asc" }],
    });
    const domain: NormalizedEvent[] = rows.map(commitments.toNormalizedEventDomain);
    return core.deriveNextReplyCycles(domain, {
      asOf,
      firstResponseCompletion: core.findFirstResponseEvent(domain, asOf),
    });
  }

  const persist = (cycles: Awaited<ReturnType<typeof deriveFromPersisted>>, asOf: string) =>
    commitments.persistNextReplyCommitments(prisma, { caseId, cycles, policyVersion, calendarVersion, asOf });

  const nextReplyRows = () =>
    prisma.commitment.findMany({ where: { caseId, kind: "next_reply" }, orderBy: { startedAt: "asc" } });

  const conversation = [
    { time: "09:00", type: "case_created", sequence: 0 },
    { time: "09:30", type: "agent_replied", sequence: 1 }, // first response
    { time: "10:00", type: "customer_replied", sequence: 2 }, // cycle 1
    { time: "10:10", type: "customer_replied", sequence: 3 },
    { time: "10:40", type: "agent_replied", sequence: 4 },
    { time: "10:45", type: "agent_replied", sequence: 5 },
    { time: "12:00", type: "customer_replied", sequence: 6 }, // cycle 2
    { time: "12:30", type: "agent_replied", sequence: 7 },
    { time: "14:00", type: "customer_replied", sequence: 8 }, // cycle 3, open
  ];

  it("persists one commitment per cycle, each starting at its own anchor, and re-running writes nothing", async () => {
    const asOf = at("14:30").toISOString();
    const cycles = await deriveFromPersisted(conversation, asOf);
    expect(cycles).toHaveLength(3);

    expect(await persist(cycles, asOf)).toEqual({ created: 3, cancelled: 0, restored: 0 });
    const first = await nextReplyRows();
    expect(first.map((r) => [r.cycleKey, r.startedAt, r.dueAt, r.targetMinutes, r.status])).toEqual(
      cycles.map((c) => [c.key, new Date(c.startedAt), new Date(new Date(c.startedAt).getTime() + 3_600_000), 60, "on_track"]),
    );

    // Renormalization regenerates every NormalizedEvent id; identities hold.
    const again = await deriveFromPersisted(conversation, at("15:00").toISOString());
    expect(await persist(again, at("15:00").toISOString())).toEqual({ created: 0, cancelled: 0, restored: 0 });
    expect((await nextReplyRows()).map((r) => [r.id, r.cycleKey])).toEqual(first.map((r) => [r.id, r.cycleKey]));
  });

  it("never duplicates a cycle when two runs race", async () => {
    const asOf = at("14:30").toISOString();
    const cycles = await deriveFromPersisted(conversation, asOf);
    await Promise.allSettled([persist(cycles, asOf), persist(cycles, asOf)]);
    await persist(cycles, asOf);
    expect(await nextReplyRows()).toHaveLength(3);
  });

  it("cancels a cycle that stops being derived and restores the same row when it comes back", async () => {
    const asOf = at("14:30").toISOString();
    await persist(await deriveFromPersisted(conversation, asOf), asOf);
    const [cycle1, cycle2, cycle3] = await nextReplyRows();

    // The 12:00 customer reply disappears on renormalization: cycle 2 is gone.
    const withoutCycle2 = conversation.filter((e) => e.sequence !== 6 && e.sequence !== 7);
    const cancelledAt = at("15:00").toISOString();
    expect(await persist(await deriveFromPersisted(withoutCycle2, cancelledAt), cancelledAt)).toEqual({
      created: 0,
      cancelled: 1,
      restored: 0,
    });
    let rows = await nextReplyRows();
    expect(rows.map((r) => [r.id, r.status, r.closedAt])).toEqual([
      [cycle1!.id, "on_track", null],
      [cycle2!.id, "cancelled", new Date(cancelledAt)],
      [cycle3!.id, "on_track", null],
    ]);

    // It comes back: the cancelled row is restored, not duplicated.
    const back = at("15:30").toISOString();
    expect(await persist(await deriveFromPersisted(conversation, back), back)).toEqual({
      created: 0,
      cancelled: 0,
      restored: 1,
    });
    rows = await nextReplyRows();
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ id: cycle2!.id, status: "on_track", closedAt: null });
  });

  it("keeps an existing cycle's frozen policy/calendar snapshot across a resync, while a genuinely new cycle gets the current one", async () => {
    const asOf = at("14:30").toISOString();
    await persist(await deriveFromPersisted(conversation, asOf), asOf);
    const [cycle1] = await nextReplyRows();
    expect(cycle1).toMatchObject({
      policyVersionId: policyVersion.id,
      calendarVersionId: calendarVersion.id,
      targetMinutes: 60,
    });

    // The org edits its SLA policy after cycle 1 already exists: a new
    // SLAPolicyVersion with a different next_reply target.
    const policyRow = await prisma.sLAPolicy.findFirstOrThrow({ where: { id: policyVersion.policyId } });
    const newPolicyRow = await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policyRow.id,
        version: 2,
        match: {},
        targets: [
          { kind: "first_response", minutes: 120 },
          { kind: "next_reply", minutes: 90 },
        ],
        pauseOnStates: ["pending_customer"],
        calendarVersionId: calendarVersion.id,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: at("14:00"),
      },
    });
    const newPolicyVersion: SLAPolicyVersion = {
      id: newPolicyRow.id,
      policyId: policyRow.id,
      version: 2,
      match: {},
      targets: [
        { kind: "first_response", minutes: 120 },
        { kind: "next_reply", minutes: 90 },
      ],
      pauseOnStates: ["pending_customer"],
      calendarVersionId: calendarVersion.id,
      warnAtPercent: [50, 80, 95],
      effectiveFrom: at("14:00").toISOString(),
    };

    // Re-deriving the same conversation plus a brand-new customer reply: the
    // existing 3 cycles are unchanged, plus one genuinely new cycle.
    const withNewReply = [...conversation, { time: "14:35", type: "agent_replied", sequence: 9 }, { time: "15:00", type: "customer_replied", sequence: 10 }];
    const laterAsOf = at("15:10").toISOString();
    const cycles = await deriveFromPersisted(withNewReply, laterAsOf);
    expect(cycles).toHaveLength(4);
    expect(
      await commitments.persistNextReplyCommitments(prisma, {
        caseId,
        cycles,
        policyVersion: newPolicyVersion,
        calendarVersion,
        asOf: laterAsOf,
      }),
    ).toEqual({ created: 1, cancelled: 0, restored: 0 });

    const rows = await nextReplyRows();
    expect(rows).toHaveLength(4);
    // Cycle 1 (and the other pre-existing cycles) keep their original,
    // frozen policy version and target — untouched by the resync's newer
    // policyVersion argument.
    expect(rows[0]).toMatchObject({
      id: cycle1!.id,
      policyVersionId: policyVersion.id,
      targetMinutes: 60,
    });
    // The newly derived cycle is frozen onto the current policy version.
    expect(rows.some((r) => r.policyVersionId === newPolicyVersion.id && r.targetMinutes === 90)).toBe(true);
  });

  it("excludes a cancelled commitment from the evaluation pipeline entirely — no new evaluation, no notification", async () => {
    const asOf = at("14:30").toISOString();
    await persist(await deriveFromPersisted(conversation, asOf), asOf);
    const [, cycle2] = await nextReplyRows();

    // The 12:00 customer reply (cycle 2's anchor) disappears on renormalization.
    const withoutCycle2 = conversation.filter((e) => e.sequence !== 6 && e.sequence !== 7);
    const cancelledAt = at("15:00").toISOString();
    await persist(await deriveFromPersisted(withoutCycle2, cancelledAt), cancelledAt);
    expect(
      await prisma.commitment.findUniqueOrThrow({ where: { id: cycle2!.id } }),
    ).toMatchObject({ status: "cancelled" });

    const organizationId = (await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).organizationId;
    // A later sweep, well past cycle 2's original 60-minute target — if it
    // were still evaluated live, it would surface as a fresh breach.
    const laterAsOf = at("16:00").toISOString();
    const swept = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: laterAsOf, scope: "all" });

    expect(swept.notificationCandidates.some((c) => c.commitmentId === cycle2!.id)).toBe(false);
    expect(await prisma.evaluation.count({ where: { commitmentId: cycle2!.id } })).toBe(0);
    // Untouched: still cancelled, closedAt still the cancellation instant.
    expect(
      await prisma.commitment.findUniqueOrThrow({ where: { id: cycle2!.id } }),
    ).toMatchObject({ status: "cancelled", closedAt: new Date(cancelledAt) });
  });

  it("never cancels a finalized commitment when its cycle disappears, and leaves its closedAt and history untouched", async () => {
    const asOf = at("14:30").toISOString();
    await persist(await deriveFromPersisted(conversation, asOf), asOf);
    const [cycle1, cycle2, cycle3] = await nextReplyRows();

    // Simulate the evaluation pipeline having already finalized cycle 1 (met)
    // and cycle 2 (breached), each with its own real closedAt and history —
    // exactly what would exist once Next Reply evaluation is wired up.
    const metClosedAt = at("10:50");
    const breachedClosedAt = at("13:10");
    await prisma.commitment.update({ where: { id: cycle1!.id }, data: { status: "met", closedAt: metClosedAt } });
    await prisma.commitment.update({ where: { id: cycle2!.id }, data: { status: "breached", closedAt: breachedClosedAt } });
    const evaluation = await prisma.evaluation.create({
      data: {
        commitmentId: cycle1!.id,
        evaluatedAt: metClosedAt,
        elapsedSeconds: 3_000,
        remainingSeconds: 600,
        status: "met",
        inputs: {},
      },
    });
    const notification = await prisma.notification.create({
      data: { commitmentId: cycle2!.id, threshold: 100, channel: "email" },
    });

    // Both cycle 1's and cycle 2's anchoring customer replies disappear on
    // renormalization; only cycle 3 (still open, never finalized) survives.
    const onlyCycle3 = conversation.filter((e) => [0, 1, 8].includes(e.sequence));
    const laterAsOf = at("15:00").toISOString();
    expect(await persist(await deriveFromPersisted(onlyCycle3, laterAsOf), laterAsOf)).toEqual({
      created: 0,
      cancelled: 0,
      restored: 0,
    });

    const rows = await nextReplyRows();
    expect(rows.map((r) => [r.id, r.status, r.closedAt])).toEqual([
      [cycle1!.id, "met", metClosedAt],
      [cycle2!.id, "breached", breachedClosedAt],
      [cycle3!.id, "on_track", null],
    ]);

    // History is untouched: same row, same values, not deleted or rewritten.
    expect(await prisma.evaluation.findUnique({ where: { id: evaluation.id } })).toMatchObject({
      commitmentId: cycle1!.id,
      status: "met",
      evaluatedAt: metClosedAt,
    });
    expect(await prisma.notification.findUnique({ where: { id: notification.id } })).toMatchObject({
      commitmentId: cycle2!.id,
      threshold: 100,
      channel: "email",
    });
  });

  it("still allows only one first response commitment per case", async () => {
    const data = {
      caseId,
      kind: "first_response" as const,
      policyVersionId: policyVersion.id,
      calendarVersionId: calendarVersion.id,
      startedAt: at("09:00"),
      targetMinutes: 120,
      dueAt: at("11:00"),
    };
    const created = await prisma.commitment.create({ data });
    expect(created.cycleKey).toBe(core.SINGLE_CYCLE_KEY);
    await expect(prisma.commitment.create({ data })).rejects.toThrow();
  });

  it("evaluates Next Reply commitments alongside First Response/Resolution in the same sweep, each against its own cycle", async () => {
    const asOf = at("14:30").toISOString();
    await persist(await deriveFromPersisted(conversation, asOf), asOf);
    const cycles = await nextReplyRows();
    expect(cycles).toHaveLength(3);
    expect(cycles.every((c) => c.status === "on_track" && c.closedAt === null)).toBe(true);

    const firstResponse = await prisma.commitment.create({
      data: {
        caseId,
        kind: "first_response",
        policyVersionId: policyVersion.id,
        calendarVersionId: calendarVersion.id,
        startedAt: at("09:00"),
        targetMinutes: 120,
        dueAt: at("11:00"),
      },
    });

    const organizationId = (await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).organizationId;
    const swept = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" });

    // The First Response commitment plus all three Next Reply cycles are
    // considered and evaluated in the same sweep — no commitmentsFailed entry
    // for any of them.
    expect(swept.commitmentsConsidered).toBe(4);
    expect(swept.commitmentsFailed).toEqual([]);
    expect(swept.evaluationsCreated).toBe(4);
    // First response, cycle 1 and cycle 2 each finalize (met); cycle 3 is
    // still open.
    expect(swept.commitmentsFinalized).toBe(3);

    const evaluatedFirstResponse = await prisma.commitment.findUniqueOrThrow({ where: { id: firstResponse.id } });
    expect(evaluatedFirstResponse.status).toBe("met"); // first agent reply at 09:30, well inside the 120-minute target

    const [cycle1, cycle2, cycle3] = await nextReplyRows();
    // Cycle 1: 10:00 anchor -> 10:40 agent reply, 40 of its 60-minute target.
    expect(cycle1).toMatchObject({ status: "met", closedAt: at("14:30") });
    // Cycle 2: 12:00 anchor -> 12:30 agent reply, 30 of its 60-minute target.
    expect(cycle2).toMatchObject({ status: "met", closedAt: at("14:30") });
    // Cycle 3: still open at 14:30 with 30 of its 60 minutes elapsed — right
    // at the 50% warn threshold, not yet breached.
    expect(cycle3).toMatchObject({ status: "at_risk", closedAt: null });

    expect(
      await prisma.evaluation.count({
        where: { commitmentId: { in: [firstResponse.id, ...cycles.map((r) => r.id)] } },
      }),
    ).toBe(4);
  });

  it("re-running the evaluation pipeline at the same asOf does not create duplicate evaluations", async () => {
    const asOf = at("14:30").toISOString();
    await persist(await deriveFromPersisted(conversation, asOf), asOf);
    const organizationId = (await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).organizationId;

    const first = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" });
    expect(first.evaluationsCreated).toBe(3);

    const second = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" });
    expect(second.commitmentsConsidered).toBe(3);
    expect(second.evaluationsCreated).toBe(0);
    expect(second.commitmentsFailed).toEqual([]);

    const rows = await nextReplyRows();
    expect(await prisma.evaluation.count({ where: { commitmentId: { in: rows.map((r) => r.id) } } })).toBe(3);
  });

  it("reconciliation can revisit a finalized Next Reply commitment without corrupting its outcome", async () => {
    const asOf = at("14:30").toISOString();
    await persist(await deriveFromPersisted(conversation, asOf), asOf);
    const organizationId = (await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).organizationId;

    await commitments.runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" });
    const [cycle1Before] = await nextReplyRows();
    expect(cycle1Before).toMatchObject({ status: "met", closedAt: at("14:30") });
    const evaluationsBefore = await prisma.evaluation.count({ where: { commitmentId: cycle1Before!.id } });

    // A later reconciliation sweep re-evaluates every commitment, including
    // already-finalized ones — cycle 1's outcome must not change or duplicate.
    const laterAsOf = at("16:00").toISOString();
    const reconciled = await commitments.runEvaluationPipeline(prisma, organizationId, {
      asOf: laterAsOf,
      scope: "all",
    });
    expect(reconciled.commitmentsFailed).toEqual([]);

    const [cycle1After] = await nextReplyRows();
    expect(cycle1After).toMatchObject({ id: cycle1Before!.id, status: "met", closedAt: at("14:30") });
    expect(await prisma.evaluation.count({ where: { commitmentId: cycle1Before!.id } })).toBe(evaluationsBefore);
  });

  it("raises a breached Next Reply cycle as a notification candidate through the existing generic path", async () => {
    const asOf = at("14:30").toISOString();
    await persist(await deriveFromPersisted(conversation, asOf), asOf);
    const organizationId = (await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).organizationId;

    // Cycle 3 (anchored at 14:00, 60-minute target) is still unanswered by 15:05.
    const laterAsOf = at("15:05").toISOString();
    const swept = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: laterAsOf, scope: "all" });

    const [, , cycle3] = await nextReplyRows();
    const candidate = swept.notificationCandidates.find((c) => c.commitmentId === cycle3!.id);
    expect(candidate).toMatchObject({
      kind: "next_reply",
      status: "breached",
      threshold: core.BREACH_NOTIFICATION_THRESHOLD,
    });

    // Breached but still open — no agent reply yet, so it isn't terminal.
    const updated = await prisma.commitment.findUniqueOrThrow({ where: { id: cycle3!.id } });
    expect(updated).toMatchObject({ status: "breached", closedAt: null });
  });
});
