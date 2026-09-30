/**
 * Active-Commitment Re-Resolution: an active commitment picks up a newly
 * applicable SLA policy when a policy-driving Case attribute (priority,
 * customer/organization, tier) changes, while its clock keeps running from
 * its original `startedAt` — elapsed time is always re-derived from the
 * event stream, never reset. Finalized/cancelled commitments are immutable.
 *
 * Real Postgres, like multi-commitment-pipeline.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { CommitmentKind, Prisma, PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("commitment re-resolution (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");

  let organizationId: string;
  let rawEventId: string;
  let calendar247Id: string;

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

    const organization = await prisma.organization.create({ data: { name: "Re-Resolution Org" } });
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
    calendar247Id = calendar.versions[0]!.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createPolicy(
    name: string,
    match: Record<string, unknown>,
    targets: { kind: string; minutes: number }[],
    overrides: Record<string, unknown> = {},
  ) {
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name } });
    return prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: match as Prisma.InputJsonValue,
        targets: targets as unknown as Prisma.InputJsonValue,
        pauseOnStates: [],
        calendarVersionId: calendar247Id,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: at("00:00"),
        ...overrides,
      },
    });
  }

  async function addPolicyVersion(
    policyId: string,
    version: number,
    match: Record<string, unknown>,
    targets: { kind: string; minutes: number }[],
    overrides: Record<string, unknown> = {},
  ) {
    return prisma.sLAPolicyVersion.create({
      data: {
        policyId,
        version,
        match: match as Prisma.InputJsonValue,
        targets: targets as unknown as Prisma.InputJsonValue,
        pauseOnStates: [],
        calendarVersionId: calendar247Id,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: at("00:00"),
        ...overrides,
      },
    });
  }

  async function createCase(overrides: Record<string, unknown> = {}) {
    return prisma.case.create({
      data: { organizationId, externalId: `case-${Math.random()}`, openedAt: at("10:00"), ...overrides },
    });
  }

  async function writeEvents(
    caseId: string,
    events: { time: string; type: string; toState?: string; actor?: string }[],
  ) {
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

  const commitmentRow = (caseId: string, kind: CommitmentKind) =>
    prisma.commitment.findFirstOrThrow({ where: { caseId, kind } });

  const auditRows = (commitmentId: string) =>
    prisma.commitmentPolicyChange.findMany({ where: { commitmentId }, orderBy: { changedAt: "asc" } });

  describe("core behavior", () => {
    it("moves Normal 60m -> Urgent 30m in place, keeps startedAt, and immediately counts prior elapsed time against the new target", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const urgent = await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "first_response", minutes: 30 }]);
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [{ time: "10:00", type: "case_created", toState: "new", actor: "customer" }]);

      expect((await commitments.runCommitmentPipeline(prisma, organizationId)).commitmentsCreated).toBe(1);
      let row = await commitmentRow(zCase.id, "first_response");
      expect(row).toMatchObject({ policyVersionId: normal.id, targetMinutes: 60, startedAt: at("10:00") });

      // Priority changes at 10:40 — 40 minutes have already elapsed under the old target.
      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      const reResolution = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:40").toISOString(),
      });
      expect(reResolution.commitmentsUpdated).toBe(1);

      row = await commitmentRow(zCase.id, "first_response");
      expect(row).toMatchObject({
        id: row.id, // same commitment id — Option A, never cancel+recreate
        policyVersionId: urgent.id,
        targetMinutes: 30,
        startedAt: at("10:00"), // clock never restarts
        calendarVersionId: calendar247Id,
      });

      // The next evaluation compares the 40 minutes already elapsed since
      // 10:00 against the new 30-minute target — it must already be
      // breached, not "30 more minutes from 10:40".
      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("10:40").toISOString() });
      row = await commitmentRow(zCase.id, "first_response");
      expect(row.status).toBe("breached");
      expect(row.closedAt).toBeNull(); // still open, not yet completed

      const audits = await auditRows(row.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        previousPolicyVersionId: normal.id,
        newPolicyVersionId: urgent.id,
        previousTargetMinutes: 60,
        newTargetMinutes: 30,
        previousCalendarVersionId: calendar247Id,
        newCalendarVersionId: calendar247Id,
        changedAt: at("10:40"),
        reason: "policy_switched",
      });
    });

    it("moves Urgent 30m -> Normal 60m in place when priority is downgraded while active", async () => {
      const urgent = await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "first_response", minutes: 30 }]);
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const zCase = await createCase({ priority: "urgent" });
      await writeEvents(zCase.id, [{ time: "10:00", type: "case_created", toState: "new", actor: "customer" }]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      expect((await commitmentRow(zCase.id, "first_response")).policyVersionId).toBe(urgent.id);

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "normal" } });
      await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf: at("10:20").toISOString() });

      const row = await commitmentRow(zCase.id, "first_response");
      expect(row).toMatchObject({ policyVersionId: normal.id, targetMinutes: 60, startedAt: at("10:00") });

      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("10:20").toISOString() });
      const evaluated = await commitmentRow(zCase.id, "first_response");
      // 20 elapsed minutes of a 60-minute target — comfortably on_track.
      expect(evaluated.status).toBe("on_track");
    });

    it("is a no-op — no update, no audit row — when the matched policy hasn't changed, including on a repeat run", async () => {
      await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const zCase = await createCase({ priority: "normal" });
      await commitments.runCommitmentPipeline(prisma, organizationId);

      const first = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId);
      expect(first.commitmentsUpdated).toBe(0);

      const row = await commitmentRow(zCase.id, "first_response");
      expect(await auditRows(row.id)).toEqual([]);

      const second = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId);
      expect(second.commitmentsUpdated).toBe(0);
      expect(await auditRows(row.id)).toEqual([]);
    });
  });

  describe("finalized commitments are immutable", () => {
    it("never touches a met commitment's policy/target/calendar", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "first_response", minutes: 30 }]);
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [
        { time: "10:00", type: "case_created", toState: "new", actor: "customer" },
        { time: "10:20", type: "agent_replied" },
      ]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("10:20").toISOString() });
      const before = await commitmentRow(zCase.id, "first_response");
      expect(before).toMatchObject({ status: "met", policyVersionId: normal.id });

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:40").toISOString(),
      });
      expect(result.commitmentsUpdated).toBe(0);
      expect(result.casesConsidered).toBe(0); // a met commitment isn't "active" at all

      const after = await commitmentRow(zCase.id, "first_response");
      expect(after).toMatchObject({
        policyVersionId: before.policyVersionId,
        targetMinutes: before.targetMinutes,
        calendarVersionId: before.calendarVersionId,
        dueAt: before.dueAt,
      });
      expect(await auditRows(before.id)).toEqual([]);
    });

    it("never touches a finalized (completed) breached commitment", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "resolution", minutes: 30 }]);
      await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "resolution", minutes: 480 }]);
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [
        { time: "10:00", type: "case_created", toState: "new", actor: "customer" },
        { time: "11:00", type: "case_closed", toState: "resolved" }, // 60 min > 30 min target: breached, then closes
      ]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("11:05").toISOString() });
      const before = await commitmentRow(zCase.id, "resolution");
      expect(before).toMatchObject({ status: "breached", policyVersionId: normal.id });
      expect(before.closedAt).not.toBeNull();

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("11:10").toISOString(),
      });
      expect(result.commitmentsUpdated).toBe(0);

      const after = await commitmentRow(zCase.id, "resolution");
      expect(after).toMatchObject({
        policyVersionId: before.policyVersionId,
        targetMinutes: before.targetMinutes,
        calendarVersionId: before.calendarVersionId,
        dueAt: before.dueAt,
      });
      expect(await auditRows(before.id)).toEqual([]);
    });

    it("never touches a still-open (uncompleted) breached commitment — a breach is final (D2, E-5)", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "resolution", minutes: 30 }]);
      const urgent = await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "resolution", minutes: 480 }]);
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [{ time: "10:00", type: "case_created", toState: "new", actor: "customer" }]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      // 45 elapsed minutes > 30-minute target, and the case is still open (no completion event).
      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("10:45").toISOString() });
      const before = await commitmentRow(zCase.id, "resolution");
      expect(before).toMatchObject({ status: "breached", policyVersionId: normal.id, targetMinutes: 30 });
      expect(before.closedAt).toBeNull(); // still open, not completed

      // A larger target must never "un-breach" it, even though the
      // commitment is still open and would otherwise be re-resolution-eligible.
      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:50").toISOString(),
      });
      expect(result.commitmentsUpdated).toBe(0);

      const after = await commitmentRow(zCase.id, "resolution");
      expect(after).toMatchObject({
        status: "breached",
        policyVersionId: before.policyVersionId,
        targetMinutes: before.targetMinutes,
        calendarVersionId: before.calendarVersionId,
        dueAt: before.dueAt,
      });
      expect(await auditRows(before.id)).toEqual([]);
      void urgent;
    });

    it("never touches a cancelled commitment", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "next_reply", minutes: 60 }]);
      await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "next_reply", minutes: 30 }]);
      const zCase = await createCase({ priority: "normal" });
      const cancelled = await prisma.commitment.create({
        data: {
          caseId: zCase.id,
          kind: "next_reply",
          cycleKey: "next_reply:zendesk:raw_1:customer_replied:2026-09-17T09:00:00.000Z",
          policyVersionId: normal.id,
          calendarVersionId: calendar247Id,
          startedAt: at("09:00"),
          targetMinutes: 60,
          dueAt: at("10:00"),
          status: "cancelled",
          closedAt: at("09:30"),
        },
      });

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId);
      expect(result.commitmentsUpdated).toBe(0);
      expect(result.casesConsidered).toBe(0);

      const after = await prisma.commitment.findUniqueOrThrow({ where: { id: cancelled.id } });
      expect(after).toMatchObject({
        status: "cancelled",
        policyVersionId: normal.id,
        targetMinutes: 60,
        calendarVersionId: calendar247Id,
      });
      expect(await auditRows(cancelled.id)).toEqual([]);
    });
  });

  describe("policy-driving attributes — all through the same generic path", () => {
    it("re-resolves on a customer/organization change", async () => {
      const defaultPolicy = await createPolicy("Default", {}, [{ kind: "first_response", minutes: 60 }]);
      const acmeCustomer = await prisma.customer.create({ data: { organizationId, name: "Acme" } });
      const acmePolicy = await createPolicy("Acme", { customerIds: [acmeCustomer.id] }, [
        { kind: "first_response", minutes: 15 },
      ]);
      const zCase = await createCase({});
      await commitments.runCommitmentPipeline(prisma, organizationId);
      expect((await commitmentRow(zCase.id, "first_response")).policyVersionId).toBe(defaultPolicy.id);

      await prisma.case.update({ where: { id: zCase.id }, data: { customerId: acmeCustomer.id } });
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId);
      expect(result.commitmentsUpdated).toBe(1);

      const row = await commitmentRow(zCase.id, "first_response");
      expect(row).toMatchObject({ policyVersionId: acmePolicy.id, targetMinutes: 15 });
    });

    it("re-resolves on a tier change", async () => {
      const defaultPolicy = await createPolicy("Default", {}, [{ kind: "first_response", minutes: 60 }]);
      const goldPolicy = await createPolicy("Gold", { tier: ["gold"] }, [{ kind: "first_response", minutes: 10 }]);
      const zCase = await createCase({});
      await commitments.runCommitmentPipeline(prisma, organizationId);
      expect((await commitmentRow(zCase.id, "first_response")).policyVersionId).toBe(defaultPolicy.id);

      await prisma.case.update({ where: { id: zCase.id }, data: { tier: "gold" } });
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId);
      expect(result.commitmentsUpdated).toBe(1);

      const row = await commitmentRow(zCase.id, "first_response");
      expect(row).toMatchObject({ policyVersionId: goldPolicy.id, targetMinutes: 10 });
    });
  });

  describe("D1/D1b: only a switch to a different policy re-resolves", () => {
    it("D1: a new version of the SAME policy (an override or re-import) never re-resolves an active commitment", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [{ time: "10:00", type: "case_created", toState: "new", actor: "customer" }]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      const before = await commitmentRow(zCase.id, "first_response");
      expect(before).toMatchObject({ policyVersionId: normal.id, targetMinutes: 60 });

      // A new version of the exact same policy (same policyId), e.g. an
      // admin edit or a Zendesk re-import bumping the target — the match
      // criteria and case attributes are unchanged.
      const normalV2 = await addPolicyVersion(normal.policyId, 2, { priority: ["normal"] }, [
        { kind: "first_response", minutes: 30 },
      ]);

      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:20").toISOString(),
      });
      expect(result.commitmentsUpdated).toBe(0);

      const after = await commitmentRow(zCase.id, "first_response");
      expect(after).toMatchObject({ policyVersionId: normal.id, targetMinutes: 60 });
      expect(await auditRows(after.id)).toEqual([]);
      void normalV2;
    });

    it("D1b: reassigning a customer's calendar alone never re-resolves an active commitment", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const customer = await prisma.customer.create({ data: { organizationId, name: "Acme" } });
      const zCase = await createCase({ priority: "normal", customerId: customer.id });
      await writeEvents(zCase.id, [{ time: "10:00", type: "case_created", toState: "new", actor: "customer" }]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      const before = await commitmentRow(zCase.id, "first_response");
      expect(before.calendarVersionId).toBe(calendar247Id);

      const narrowCalendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          name: "Narrow",
          versions: {
            create: { version: 1, timezone: "UTC", weekly: [{ day: 4, openMinute: 0, closeMinute: 30 }], holidays: [], alwaysOpen: false },
          },
        },
        include: { versions: true },
      });
      await prisma.customer.update({ where: { id: customer.id }, data: { calendarId: narrowCalendar.id } });

      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:20").toISOString(),
      });
      expect(result.commitmentsUpdated).toBe(0);

      const after = await commitmentRow(zCase.id, "first_response");
      expect(after).toMatchObject({
        policyVersionId: normal.id,
        calendarVersionId: calendar247Id, // unchanged — a calendar reassignment applies to new commitments only
      });
      expect(await auditRows(after.id)).toEqual([]);
    });
  });

  describe("resolution commitments", () => {
    it("re-resolves an active Resolution commitment and keeps its pause behavior intact under the new target", async () => {
      const normal = await createPolicy(
        "Normal",
        { priority: ["normal"] },
        [{ kind: "resolution", minutes: 480 }],
        { pauseOnStates: ["pending_customer"] },
      );
      const urgent = await createPolicy(
        "Urgent",
        { priority: ["urgent"] },
        [{ kind: "resolution", minutes: 60 }],
        { pauseOnStates: ["pending_customer"] },
      );
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [
        { time: "10:00", type: "case_created", toState: "new", actor: "customer" },
        { time: "10:10", type: "state_changed", toState: "pending_customer" }, // clock pauses here
      ]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      expect((await commitmentRow(zCase.id, "resolution")).policyVersionId).toBe(normal.id);

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf: at("10:30").toISOString() });
      const reResolved = await commitmentRow(zCase.id, "resolution");
      expect(reResolved).toMatchObject({ policyVersionId: urgent.id, targetMinutes: 60, startedAt: at("10:00") });

      // Still paused at 11:00 (no unpause event): only the 10 minutes before
      // the pause (10:00-10:10) ever counted, regardless of the new target.
      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("11:00").toISOString() });
      const evaluation = await prisma.evaluation.findFirstOrThrow({
        where: { commitmentId: reResolved.id },
        orderBy: { evaluatedAt: "desc" },
      });
      expect(evaluation.elapsedSeconds).toBe(10 * 60);
      expect(evaluation.status).not.toBe("breached"); // 10 of 60 minutes — still on_track/at_risk
      const finalRow = await commitmentRow(zCase.id, "resolution");
      expect(finalRow.status).not.toBe("breached");
    });
  });

  describe("Next Reply cycles", () => {
    // The anchor is an active Resolution commitment, not First Response:
    // First Response typically finalizes within minutes (met/breached), and
    // a finalized commitment is immutable (see "finalized commitments are
    // immutable" above) — it would never pick up a re-resolved policy again,
    // so it could never carry a new policy forward to a future cycle either.
    // Resolution realistically stays open across a case's whole conversation
    // (many Next Reply cycles), which is what actually lets a still-active
    // anchor's re-resolved policy flow into cycle-pipeline's next run.
    async function seedAnchorAndOpenCycle(policyVersionId: string) {
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [
        { time: "10:00", type: "case_created", toState: "new", actor: "customer" },
        { time: "10:15", type: "agent_replied" },
        { time: "10:30", type: "customer_replied", actor: "customer" },
      ]);
      await prisma.commitment.create({
        data: {
          caseId: zCase.id,
          kind: "resolution",
          policyVersionId,
          calendarVersionId: calendar247Id,
          startedAt: at("10:00"),
          targetMinutes: 480,
          dueAt: at("18:00"),
        },
      });
      await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf: at("10:30").toISOString() });
      return zCase;
    }

    it("re-resolves an open cycle's commitment in place — same id, same cycleKey, same startedAt", async () => {
      const normal = await createPolicy(
        "Normal",
        { priority: ["normal"] },
        [{ kind: "resolution", minutes: 480 }, { kind: "next_reply", minutes: 120 }],
      );
      const urgent = await createPolicy(
        "Urgent",
        { priority: ["urgent"] },
        [{ kind: "resolution", minutes: 60 }, { kind: "next_reply", minutes: 45 }],
      );
      const zCase = await seedAnchorAndOpenCycle(normal.id);
      const before = await commitmentRow(zCase.id, "next_reply");
      expect(before).toMatchObject({ status: "on_track", policyVersionId: normal.id, targetMinutes: 120 });

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      // Both the active Resolution anchor and the open cycle re-resolve.
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:45").toISOString(),
      });
      expect(result.commitmentsUpdated).toBe(2);

      const after = await commitmentRow(zCase.id, "next_reply");
      expect(after).toMatchObject({
        id: before.id,
        cycleKey: before.cycleKey,
        startedAt: before.startedAt,
        policyVersionId: urgent.id,
        targetMinutes: 45,
      });
    });

    it("uses the newly-resolved anchor policy for a future cycle created after the change", async () => {
      const normal = await createPolicy(
        "Normal",
        { priority: ["normal"] },
        [{ kind: "resolution", minutes: 480 }, { kind: "next_reply", minutes: 120 }],
      );
      const urgent = await createPolicy(
        "Urgent",
        { priority: ["urgent"] },
        [{ kind: "resolution", minutes: 60 }, { kind: "next_reply", minutes: 45 }],
      );
      const zCase = await seedAnchorAndOpenCycle(normal.id);

      // The first cycle is answered, and the anchor's policy is re-resolved
      // to Urgent before a second cycle ever opens.
      await writeEvents(zCase.id, [{ time: "10:40", type: "agent_replied" }]);
      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf: at("10:45").toISOString() });
      expect((await commitmentRow(zCase.id, "resolution")).policyVersionId).toBe(urgent.id);

      // A new customer reply opens a second cycle.
      await writeEvents(zCase.id, [{ time: "11:00", type: "customer_replied", actor: "customer" }]);
      await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf: at("11:00").toISOString() });

      const rows = await prisma.commitment.findMany({
        where: { caseId: zCase.id, kind: "next_reply" },
        orderBy: { startedAt: "asc" },
      });
      expect(rows).toHaveLength(2);
      // The second (future) cycle is created fresh under the already
      // re-resolved anchor policy — no separate mechanism needed.
      expect(rows[1]).toMatchObject({ startedAt: at("11:00"), policyVersionId: urgent.id, targetMinutes: 45 });
    });

    it("never touches a finalized (answered) Next Reply cycle", async () => {
      const normal = await createPolicy(
        "Normal",
        { priority: ["normal"] },
        [{ kind: "resolution", minutes: 480 }, { kind: "next_reply", minutes: 120 }],
      );
      await createPolicy(
        "Urgent",
        { priority: ["urgent"] },
        [{ kind: "resolution", minutes: 60 }, { kind: "next_reply", minutes: 45 }],
      );
      const zCase = await seedAnchorAndOpenCycle(normal.id);
      // The cycle is answered before the priority change; the Resolution
      // anchor stays open.
      await writeEvents(zCase.id, [{ time: "10:40", type: "agent_replied" }]);
      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("10:40").toISOString() });
      const before = await commitmentRow(zCase.id, "next_reply");
      expect(before).toMatchObject({ status: "met" });
      expect(before.closedAt).not.toBeNull();

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:45").toISOString(),
      });
      // Only the still-active Resolution anchor re-resolves — the finalized
      // cycle is not a candidate at all.
      expect(result.commitmentsUpdated).toBe(1);
      expect((await commitmentRow(zCase.id, "resolution")).policyVersionId).not.toBe(normal.id);

      const after = await commitmentRow(zCase.id, "next_reply");
      expect(after).toMatchObject({
        policyVersionId: before.policyVersionId,
        targetMinutes: before.targetMinutes,
        status: "met",
      });
      expect(await auditRows(before.id)).toEqual([]);
    });
  });

  describe("calendar behavior", () => {
    it("re-prices the entire elapsed window (including the pre-change portion) under the newly-matched policy's calendar, without moving startedAt", async () => {
      const narrowCalendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          name: "Thursday 00:00-00:30 only",
          versions: {
            // 2026-09-17 is a Thursday (weekday 4). A 30-minute weekly window
            // that the 10:00-10:40 test window falls entirely outside of.
            create: { version: 1, timezone: "UTC", weekly: [{ day: 4, openMinute: 0, closeMinute: 30 }], holidays: [], alwaysOpen: false },
          },
        },
        include: { versions: true },
      });
      const narrowCalendarVersionId = narrowCalendar.versions[0]!.id;

      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const urgent = await createPolicy(
        "Urgent",
        { priority: ["urgent"] },
        [{ kind: "first_response", minutes: 30 }],
        { calendarVersionId: narrowCalendarVersionId },
      );
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [{ time: "10:00", type: "case_created", toState: "new", actor: "customer" }]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      expect((await commitmentRow(zCase.id, "first_response")).calendarVersionId).toBe(calendar247Id);

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf: at("10:40").toISOString() });
      const reResolved = await commitmentRow(zCase.id, "first_response");
      expect(reResolved).toMatchObject({
        policyVersionId: urgent.id,
        calendarVersionId: narrowCalendarVersionId,
        startedAt: at("10:00"), // clock anchor never moves
      });

      // Under the new calendar, the whole 10:00-10:40 window (entirely
      // outside the 00:00-00:30 working window) contributes zero working
      // minutes — not just time going forward from the policy change.
      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: at("10:40").toISOString() });
      const evaluation = await prisma.evaluation.findFirstOrThrow({
        where: { commitmentId: reResolved.id },
        orderBy: { evaluatedAt: "desc" },
      });
      expect(evaluation.elapsedSeconds).toBe(0);
      expect(evaluation.status).toBe("on_track");
    });
  });

  describe("missing target in the newly matched policy", () => {
    it("leaves the commitment unchanged and logs a warning instead of cancelling/replacing it", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "next_reply", minutes: 120 }]);
      // Urgent matches on priority but was never configured with a next_reply target.
      await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "first_response", minutes: 30 }]);
      const zCase = await createCase({ priority: "normal" });
      const cycleCommitment = await prisma.commitment.create({
        data: {
          caseId: zCase.id,
          kind: "next_reply",
          cycleKey: "next_reply:zendesk:raw_1:customer_replied:2026-09-17T10:00:00.000Z",
          policyVersionId: normal.id,
          calendarVersionId: calendar247Id,
          startedAt: at("10:00"),
          targetMinutes: 120,
          dueAt: at("12:00"),
        },
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      const result = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId);
      expect(result.commitmentsUpdated).toBe(0);
      expect(result.commitmentsMissingTarget).toBe(1);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();

      const after = await prisma.commitment.findUniqueOrThrow({ where: { id: cycleCommitment.id } });
      expect(after).toMatchObject({
        status: "on_track",
        policyVersionId: normal.id,
        targetMinutes: 120,
        calendarVersionId: calendar247Id,
      });
      expect(await auditRows(cycleCommitment.id)).toEqual([]);
    });
  });

  describe("notifications", () => {
    it("does not duplicate an existing threshold notification merely because the target changed", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const urgent = await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "first_response", minutes: 30 }]);
      const zCase = await createCase({ priority: "normal" });
      await writeEvents(zCase.id, [{ time: "10:00", type: "case_created", toState: "new", actor: "customer" }]);
      await commitments.runCommitmentPipeline(prisma, organizationId);
      const before = await commitmentRow(zCase.id, "first_response");

      // A 50%-consumed notification was already sent for this exact commitment id.
      const existing = await prisma.notification.create({
        data: { commitmentId: before.id, threshold: 50, channel: "slack" },
      });

      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });
      await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf: at("10:40").toISOString() });
      // Re-resolution itself never touches Notification, and the existing
      // threshold-50 row is still exactly the one we created.
      const afterReResolution = await prisma.notification.findMany({ where: { commitmentId: before.id } });
      expect(afterReResolution).toEqual([expect.objectContaining({ id: existing.id, threshold: 50 })]);

      const evaluation = await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: at("10:40").toISOString(),
      });
      const candidatesForCommitment = evaluation.notificationCandidates.filter((c) => c.commitmentId === before.id);
      // The target change makes this commitment breach outright, which is a
      // genuinely new (commitmentId, threshold=100) candidate — distinct
      // from, and never a duplicate of, the already-recorded threshold=50.
      // The commitment id never changed (Option A, not cancel+recreate), so
      // `runNotificationPipeline`'s (commitmentId, threshold) dedup still
      // resolves against the exact same existing row.
      expect(candidatesForCommitment).toEqual([
        expect.objectContaining({ commitmentId: before.id, threshold: 100, status: "breached" }),
      ]);
      expect(candidatesForCommitment.some((c) => c.threshold === 50)).toBe(false);
      void urgent;
    });
  });

  describe("convergence and idempotency", () => {
    it("produces the identical resulting commitment for identical starting state, regardless of which case/trigger it runs for", async () => {
      const normal = await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const urgent = await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "first_response", minutes: 30 }]);

      const caseA = await createCase({ priority: "normal" });
      const caseB = await createCase({ priority: "normal" });
      await commitments.runCommitmentPipeline(prisma, organizationId);
      await prisma.case.update({ where: { id: caseA.id }, data: { priority: "urgent" } });
      await prisma.case.update({ where: { id: caseB.id }, data: { priority: "urgent" } });

      const asOf = at("10:40").toISOString();
      await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, { asOf });
      const rowA = await commitmentRow(caseA.id, "first_response");
      const rowB = await commitmentRow(caseB.id, "first_response");

      expect(rowA.policyVersionId).toBe(urgent.id);
      expect(rowB.policyVersionId).toBe(urgent.id);
      expect(rowA.targetMinutes).toBe(rowB.targetMinutes);
      expect(rowA.startedAt).toEqual(rowB.startedAt);
      expect(rowA.calendarVersionId).toBe(rowB.calendarVersionId);
      void normal;
    });

    it("running the pipeline twice with no intervening change writes no second update and no second audit row", async () => {
      await createPolicy("Normal", { priority: ["normal"] }, [{ kind: "first_response", minutes: 60 }]);
      const urgent = await createPolicy("Urgent", { priority: ["urgent"] }, [{ kind: "first_response", minutes: 30 }]);
      const zCase = await createCase({ priority: "normal" });
      await commitments.runCommitmentPipeline(prisma, organizationId);
      await prisma.case.update({ where: { id: zCase.id }, data: { priority: "urgent" } });

      const first = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:40").toISOString(),
      });
      expect(first.commitmentsUpdated).toBe(1);
      const row = await commitmentRow(zCase.id, "first_response");
      expect(row.policyVersionId).toBe(urgent.id);
      expect(await auditRows(row.id)).toHaveLength(1);

      const second = await commitments.runCommitmentReResolutionPipeline(prisma, organizationId, {
        asOf: at("10:41").toISOString(),
      });
      expect(second.commitmentsUpdated).toBe(0);
      expect(await auditRows(row.id)).toHaveLength(1);
    });
  });
});
