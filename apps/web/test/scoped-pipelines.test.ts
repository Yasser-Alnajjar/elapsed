/**
 * Roadmap 7.7 Phase 3, items 3/4/6: pipelines can be scoped to a set of case
 * ids (webhook deliveries), and the batched work inside them must give the
 * same answer as the row-at-a-time code it replaced.
 *
 * "Never skip a changed case": a scoped run has to handle *every* named case,
 * including ones past a chunk boundary (IN lists are chunked), and must not
 * touch a case it wasn't given.
 *
 * Real Postgres; needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test". Skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const OPENED = new Date("2026-09-17T09:00:00.000Z");
// Well past a 5-minute resolution target: every open commitment breaches.
const AS_OF = "2026-09-17T12:00:00.000Z";

describe.skipIf(!TEST_DATABASE_URL)("scoped pipelines (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");

  let organizationId: string;
  let rawEventId: string;
  let calendarVersionId: string;
  let policyVersionId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
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
    organizationId = (await prisma.organization.create({ data: { name: "Scoped Org" } })).id;
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
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Policy" } });
    policyVersionId = (
      await prisma.sLAPolicyVersion.create({
        data: {
          policyId: policy.id,
          version: 1,
          match: {},
          targets: [
            { kind: "first_response", minutes: 5 },
            { kind: "resolution", minutes: 5 },
          ],
          pauseOnStates: [],
          calendarVersionId,
          warnAtPercent: [50, 80, 95],
          effectiveFrom: new Date("2026-09-17T00:00:00.000Z"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createCases(n: number): Promise<string[]> {
    await prisma.case.createMany({
      data: Array.from({ length: n }, (_, i) => ({ organizationId, system: "zendesk", externalId: `t-${i}`, openedAt: OPENED })),
    });
    const rows = await prisma.case.findMany({ where: { organizationId }, orderBy: { externalId: "asc" }, select: { id: true } });
    await prisma.normalizedEvent.createMany({
      data: rows.map(({ id }) => ({
        caseId: id,
        sourceRawEventId: rawEventId,
        type: "case_created",
        occurredAt: OPENED,
        actor: "customer",
        system: "zendesk" as const,
        sourceRole: "ticket_source" as const,
        sourceSequence: 0,
      })),
    });
    return rows.map((r) => r.id);
  }

  async function createOpenResolutionCommitments(caseIds: string[]) {
    await prisma.commitment.createMany({
      data: caseIds.map((caseId) => ({
        caseId,
        kind: "resolution" as const,
        policyVersionId,
        calendarVersionId,
        startedAt: OPENED,
        targetMinutes: 5,
        dueAt: new Date(OPENED.getTime() + 5 * 60_000),
      })),
    });
  }

  describe("runCommitmentPipeline", () => {
    it("creates both kinds for exactly the named cases", async () => {
      const [a, b, c] = await createCases(3);

      const result = await commitments.runCommitmentPipeline(prisma, organizationId, { caseIds: [a!, b!] });

      expect(result.commitmentsCreated).toBe(4);
      const byCase = await prisma.commitment.groupBy({ by: ["caseId"], _count: true });
      expect(byCase.map((r) => r.caseId).sort()).toEqual([a, b].sort());
      expect(await prisma.commitment.count({ where: { caseId: c } })).toBe(0);
    });

    it("only loads cases still missing a kind, and a re-run creates nothing", async () => {
      const ids = await createCases(3);
      await commitments.runCommitmentPipeline(prisma, organizationId);

      const rerun = await commitments.runCommitmentPipeline(prisma, organizationId);

      expect(rerun.casesConsidered).toBe(0);
      expect(rerun.commitmentsCreated).toBe(0);
      expect(await prisma.commitment.count()).toBe(ids.length * 2);
    });

    it("completes a case that has only one of its kinds", async () => {
      const [only] = await createCases(1);
      await prisma.commitment.create({
        data: {
          caseId: only!,
          kind: "first_response",
          policyVersionId,
          calendarVersionId,
          startedAt: OPENED,
          targetMinutes: 5,
          dueAt: new Date(OPENED.getTime() + 5 * 60_000),
        },
      });

      const result = await commitments.runCommitmentPipeline(prisma, organizationId);

      expect(result.commitmentsCreated).toBe(1);
      expect((await prisma.commitment.findMany({ where: { caseId: only }, select: { kind: true } })).map((c) => c.kind).sort()).toEqual([
        "first_response",
        "resolution",
      ]);
    });
  });

  describe("runEvaluationPipeline", () => {
    it("evaluates exactly the named cases and leaves the others' commitments alone", async () => {
      const [a, b] = await createCases(2);
      await createOpenResolutionCommitments([a!, b!]);

      const result = await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: AS_OF,
        scope: "active",
        caseIds: [a!],
      });

      expect(result.commitmentsConsidered).toBe(1);
      expect((await prisma.commitment.findFirstOrThrow({ where: { caseId: a } })).status).toBe("breached");
      expect((await prisma.commitment.findFirstOrThrow({ where: { caseId: b } })).status).toBe("on_track");
    });

    it("an empty scope evaluates nothing", async () => {
      const ids = await createCases(2);
      await createOpenResolutionCommitments(ids);

      const result = await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: AS_OF,
        scope: "active",
        caseIds: [],
      });

      expect(result.commitmentsConsidered).toBe(0);
      expect(await prisma.commitment.count({ where: { status: "breached" } })).toBe(0);
    });

    it("applies every status change across a chunk boundary (batched UPDATE … FROM VALUES)", async () => {
      // More than one IN-list / UPDATE chunk, so the last row of a later
      // chunk can't be silently dropped.
      const n = commitments.IN_LIST_CHUNK_SIZE + 25;
      const ids = await createCases(n);
      await createOpenResolutionCommitments(ids);

      const result = await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: AS_OF, scope: "active" });

      expect(result.commitmentsConsidered).toBe(n);
      expect(await prisma.commitment.count({ where: { status: "breached" } })).toBe(n);
      // Not finalized: breached but never completed, so still active.
      expect(await prisma.commitment.count({ where: { closedAt: null } })).toBe(n);
      expect(await prisma.evaluation.count()).toBe(n);
    });

    it("sets and clears closedAt exactly as before: a met commitment is finalized at the evaluation instant", async () => {
      const [a] = await createCases(1);
      await createOpenResolutionCommitments([a!]);
      await prisma.normalizedEvent.create({
        data: {
          caseId: a!,
          sourceRawEventId: rawEventId,
          type: "case_closed",
          occurredAt: new Date(OPENED.getTime() + 2 * 60_000),
          actor: "agent",
          system: "zendesk",
          sourceRole: "ticket_source",
          fromState: "open",
          toState: "resolved",
          sourceSequence: 1,
        },
      });

      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: AS_OF, scope: "active" });

      const row = await prisma.commitment.findFirstOrThrow({ where: { caseId: a } });
      expect(row.status).toBe("met");
      expect(row.closedAt).toEqual(new Date(AS_OF));
    });

    it("previous status comes from the latest evaluation (DISTINCT ON), so an unchanged status writes no new row", async () => {
      const [a] = await createCases(1);
      await createOpenResolutionCommitments([a!]);

      await commitments.runEvaluationPipeline(prisma, organizationId, { asOf: AS_OF, scope: "active" });
      expect(await prisma.evaluation.count()).toBe(1);

      // Same status later: nothing changed, so no second snapshot.
      await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: "2026-09-17T13:00:00.000Z",
        scope: "active",
      });
      expect(await prisma.evaluation.count()).toBe(1);
    });
  });
});
