/**
 * `runNextReplyCyclePipeline` (Step 7): the org-wide orchestrator that wires
 * `persistNextReplyCommitments` into normal case synchronization. Unlike
 * next-reply-commitment-persistence.test.ts (which calls
 * `persistNextReplyCommitments` directly with hand-derived cycles), this
 * exercises the orchestrator's own job: picking each case's policy/calendar
 * anchor from its existing First Response/Resolution commitment, deciding
 * whether that anchor's policy version even targets `next_reply`, and
 * skipping a case with no anchor at all.
 *
 * Real Postgres, like next-reply-commitment-persistence.test.ts. Needs a
 * migrated database at TEST_DATABASE_URL whose name contains "test"; skipped
 * when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const at = (time: string) => new Date(`2026-09-17T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("runNextReplyCyclePipeline (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");

  let organizationId: string;
  let calendarVersionId: string;
  let policyWithTargetVersionId: string;
  let policyWithoutTargetVersionId: string;
  let rawEventId: string;

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

    const organization = await prisma.organization.create({ data: { name: "Cycle Pipeline Org" } });
    organizationId = organization.id;
    const zendesk = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", credentials: { subdomain: "demo" } },
    });
    rawEventId = (
      await prisma.rawEvent.create({
        data: { integrationId: zendesk.id, providerEventId: "ticket:1", sourceHash: "h", payload: { id: 1 } },
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

    const policyWithTarget = await prisma.sLAPolicy.create({ data: { organizationId, name: "With Next Reply" } });
    policyWithTargetVersionId = (
      await prisma.sLAPolicyVersion.create({
        data: {
          policyId: policyWithTarget.id,
          version: 1,
          match: {},
          targets: [
            { kind: "first_response", minutes: 120 },
            { kind: "next_reply", minutes: 60 },
          ],
          pauseOnStates: [],
          calendarVersionId,
          warnAtPercent: [50, 80, 95],
          effectiveFrom: at("00:00"),
        },
      })
    ).id;

    const policyWithoutTarget = await prisma.sLAPolicy.create({ data: { organizationId, name: "No Next Reply" } });
    policyWithoutTargetVersionId = (
      await prisma.sLAPolicyVersion.create({
        data: {
          policyId: policyWithoutTarget.id,
          version: 1,
          match: {},
          targets: [{ kind: "first_response", minutes: 120 }],
          pauseOnStates: [],
          calendarVersionId,
          warnAtPercent: [50, 80, 95],
          effectiveFrom: at("00:00"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  let nextExternalId = 0;
  async function createCase(): Promise<string> {
    nextExternalId += 1;
    return (
      await prisma.case.create({
        data: { organizationId, externalId: `case-${nextExternalId}`, openedAt: at("09:00") },
      })
    ).id;
  }

  async function seedConversation(caseId: string) {
    await prisma.normalizedEvent.createMany({
      data: [
        { caseId, sourceRawEventId: rawEventId, type: "case_created", occurredAt: at("09:00"), actor: "customer", system: "zendesk", sourceSequence: 0 },
        { caseId, sourceRawEventId: rawEventId, type: "agent_replied", occurredAt: at("09:30"), actor: "agent", system: "zendesk", sourceSequence: 1 },
        { caseId, sourceRawEventId: rawEventId, type: "customer_replied", occurredAt: at("10:00"), actor: "customer", system: "zendesk", sourceSequence: 2 },
      ],
    });
  }

  const nextReplyRows = (caseId: string) =>
    prisma.commitment.findMany({ where: { caseId, kind: "next_reply" }, orderBy: { startedAt: "asc" } });

  it("derives and persists cycles for a case whose anchor policy targets next_reply", async () => {
    const caseId = await createCase();
    await seedConversation(caseId);
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "first_response",
        policyVersionId: policyWithTargetVersionId,
        calendarVersionId,
        startedAt: at("09:00"),
        targetMinutes: 120,
        dueAt: at("11:00"),
      },
    });

    const asOf = at("11:00").toISOString();
    const result = await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });

    expect(result.casesFailed).toEqual([]);
    expect(result.cyclesCreated).toBe(1);
    const rows = await nextReplyRows(caseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "on_track", startedAt: at("10:00"), targetMinutes: 60 });

    // Re-running with the same data is a no-op.
    const again = await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });
    expect(again).toMatchObject({ cyclesCreated: 0, cyclesCancelled: 0, cyclesRestored: 0 });
    expect(await nextReplyRows(caseId)).toHaveLength(1);
  });

  it("derives no cycles and cancels a previously-live one when the anchor policy has no next_reply target", async () => {
    const caseId = await createCase();
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "first_response",
        policyVersionId: policyWithoutTargetVersionId,
        calendarVersionId,
        startedAt: at("09:00"),
        targetMinutes: 120,
        dueAt: at("11:00"),
      },
    });
    // A Next Reply commitment already exists on the case (e.g. from before the
    // policy was edited to drop the next_reply target, or a stale test fixture).
    const stale = await prisma.commitment.create({
      data: {
        caseId,
        kind: "next_reply",
        cycleKey: "next_reply:zendesk:raw_stale:customer_replied:2026-09-17T10:00:00.000Z",
        policyVersionId: policyWithoutTargetVersionId,
        calendarVersionId,
        startedAt: at("10:00"),
        targetMinutes: 60,
        dueAt: at("11:00"),
      },
    });

    const asOf = at("11:00").toISOString();
    const result = await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });

    expect(result.casesFailed).toEqual([]);
    expect(result.cyclesCreated).toBe(0);
    expect(result.cyclesCancelled).toBe(1);
    const row = await prisma.commitment.findUniqueOrThrow({ where: { id: stale.id } });
    expect(row).toMatchObject({ status: "cancelled", closedAt: new Date(asOf) });
  });

  it("skips a case with no First Response/Resolution commitment yet, without failing", async () => {
    const caseId = await createCase();
    await seedConversation(caseId);
    // No commitment created for this case at all — e.g. no policy matched it yet.

    const result = await commitments.runNextReplyCyclePipeline(prisma, organizationId, {
      asOf: at("11:00").toISOString(),
    });

    // A case with no anchor is never even loaded.
    expect(result.casesConsidered).toBe(0);
    expect(result.casesFailed).toEqual([]);
    expect(result.cyclesCreated).toBe(0);
    expect(await nextReplyRows(caseId)).toEqual([]);
  });

  it("processes every case in the organization independently", async () => {
    const withTarget = await createCase();
    await seedConversation(withTarget);
    await prisma.commitment.create({
      data: {
        caseId: withTarget,
        kind: "first_response",
        policyVersionId: policyWithTargetVersionId,
        calendarVersionId,
        startedAt: at("09:00"),
        targetMinutes: 120,
        dueAt: at("11:00"),
      },
    });

    const unanchored = await createCase();

    const result = await commitments.runNextReplyCyclePipeline(prisma, organizationId, {
      asOf: at("11:00").toISOString(),
    });

    expect(result.casesConsidered).toBe(1);
    expect(result.casesFailed).toEqual([]);
    expect(result.cyclesCreated).toBe(1);
    expect(await nextReplyRows(withTarget)).toHaveLength(1);
    expect(await nextReplyRows(unanchored)).toEqual([]);
  });

  it("anchors on resolution, not first_response, when a case has both (E-1 regression)", async () => {
    // First Response finished under the policy version with no next_reply
    // target; Resolution was since re-resolved onto the version that has
    // one. The anchor pick must be deterministic and favor the fresher,
    // still-open Resolution commitment — not whichever row Postgres
    // happens to return first.
    const caseId = await createCase();
    await seedConversation(caseId);
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "first_response",
        policyVersionId: policyWithoutTargetVersionId,
        calendarVersionId,
        startedAt: at("09:00"),
        targetMinutes: 120,
        dueAt: at("11:00"),
        status: "met",
        closedAt: at("09:30"),
      },
    });
    await prisma.commitment.create({
      data: {
        caseId,
        kind: "resolution",
        policyVersionId: policyWithTargetVersionId,
        calendarVersionId,
        startedAt: at("09:00"),
        targetMinutes: 480,
        dueAt: at("17:00"),
      },
    });

    const result = await commitments.runNextReplyCyclePipeline(prisma, organizationId, {
      asOf: at("11:00").toISOString(),
    });

    expect(result.casesFailed).toEqual([]);
    expect(result.cyclesCreated).toBe(1);
    const rows = await nextReplyRows(caseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ policyVersionId: policyWithTargetVersionId });
  });

  describe("scoping (roadmap 7.7 Phase 3)", () => {
    async function anchoredCase(options: { closed?: boolean } = {}): Promise<string> {
      const caseId = await createCase();
      await seedConversation(caseId);
      await prisma.commitment.create({
        data: {
          caseId,
          kind: "first_response",
          policyVersionId: policyWithTargetVersionId,
          calendarVersionId,
          startedAt: at("09:00"),
          targetMinutes: 120,
          dueAt: at("11:00"),
          // A finalized (met) anchor: no active commitment on the case.
          ...(options.closed ? { status: "met" as const, closedAt: at("09:30") } : {}),
        },
      });
      return caseId;
    }

    const asOf = at("11:00").toISOString();
    const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

    it("active scope re-derives a case with an active commitment", async () => {
      const caseId = await anchoredCase();
      const result = await commitments.runNextReplyCyclePipeline(prisma, organizationId, {
        asOf,
        scope: "active",
        changedSince: new Date(Date.now() + 60_000),
      });
      expect(result.casesConsidered).toBe(1);
      expect(await nextReplyRows(caseId)).toHaveLength(1);
    });

    it("active scope skips a finalized case with no recent events, and the full scope catches it", async () => {
      const caseId = await anchoredCase({ closed: true });
      // Events were created "now" by seedConversation; look only after that.
      const active = await commitments.runNextReplyCyclePipeline(prisma, organizationId, {
        asOf,
        scope: "active",
        changedSince: new Date(Date.now() + 60_000),
      });
      expect(active.casesConsidered).toBe(0);
      expect(await nextReplyRows(caseId)).toEqual([]);

      // The hourly reconciliation sweep (no scope) is the backstop.
      const all = await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });
      expect(all.casesConsidered).toBe(1);
      expect(await nextReplyRows(caseId)).toHaveLength(1);
    });

    it("active scope picks up a finalized case that has a new event", async () => {
      const caseId = await anchoredCase({ closed: true });
      const result = await commitments.runNextReplyCyclePipeline(prisma, organizationId, {
        asOf,
        scope: "active",
        changedSince: hourAgo(),
      });
      expect(result.casesConsidered).toBe(1);
      expect(await nextReplyRows(caseId)).toHaveLength(1);
    });

    it("requires changedSince for the active scope", async () => {
      await expect(
        commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf, scope: "active" }),
      ).rejects.toThrow(/changedSince/);
    });

    it("caseIds limits the run to the named cases and never skips a named one", async () => {
      const touched = await anchoredCase();
      const untouched = await anchoredCase();

      const result = await commitments.runNextReplyCyclePipeline(prisma, organizationId, {
        asOf,
        caseIds: [touched],
      });
      expect(result.casesConsidered).toBe(1);
      expect(await nextReplyRows(touched)).toHaveLength(1);
      expect(await nextReplyRows(untouched)).toEqual([]);
    });

    it("writes nothing for a case whose persisted commitments already match", async () => {
      const caseId = await anchoredCase();
      await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });
      const before = await nextReplyRows(caseId);

      const rerun = await commitments.runNextReplyCyclePipeline(prisma, organizationId, { asOf });
      expect(rerun).toMatchObject({ cyclesCreated: 0, cyclesCancelled: 0, cyclesRestored: 0 });
      expect(await nextReplyRows(caseId)).toEqual(before);
    });
  });
});
