/**
 * `runEvaluationPipeline`'s commitment status write must be conditional
 * (roadmap step 0.8, E-2): it read `commitmentRows` once at the start and
 * then wrote `status`/`closedAt` back with an unconditional `update`, so a
 * concurrent process that cancelled the commitment, or a re-resolution that
 * moved it onto a different policy version, in between could be silently
 * clobbered by a status computed from the now-stale row.
 *
 * Each test spies on `prisma.commitment.findMany` to mutate the row via a
 * second, independent write right after the pipeline reads it — the same
 * shape a genuinely concurrent request would race with, made deterministic.
 *
 * Real Postgres, like evaluation-persistence.test.ts. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const OPENED = new Date("2026-09-17T09:00:00.000Z");
const AS_OF = "2026-09-17T09:10:00.000Z";

describe.skipIf(!TEST_DATABASE_URL)(
  "runEvaluationPipeline conditional commitment writes (real Postgres)",
  () => {
    let prisma: PrismaClient;
    let commitments: typeof import("@sla/commitments");

    let organizationId: string;
    let caseId: string;
    let calendarVersionId: string;
    let policyVersionAId: string;
    let policyVersionBId: string;

    beforeAll(async () => {
      const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
      if (!/test/i.test(name)) {
        throw new Error(
          `TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`,
        );
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

      const organization = await prisma.organization.create({
        data: { name: "Conditional Write Org" },
      });
      organizationId = organization.id;
      const zendesk = await prisma.integration.create({
        data: {
          organizationId,
          provider: "zendesk",
          credentials: { subdomain: "demo" },
        },
      });
      const rawEvent = await prisma.rawEvent.create({
        data: {
          integrationId: zendesk.id,
          providerEventId: "ticket:1",
          sourceHash: "h",
          payload: { id: 1 },
        },
      });

      const calendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          name: "24/7",
          versions: {
            create: {
              version: 1,
              timezone: "UTC",
              weekly: [],
              holidays: [],
              alwaysOpen: true,
            },
          },
        },
        include: { versions: true },
      });
      calendarVersionId = calendar.versions[0]!.id;

      const policy = await prisma.sLAPolicy.create({
        data: { organizationId, name: "Urgent" },
      });
      policyVersionAId = (
        await prisma.sLAPolicyVersion.create({
          data: {
            policyId: policy.id,
            version: 1,
            match: {},
            targets: [{ kind: "resolution", minutes: 5 }],
            pauseOnStates: [],
            calendarVersionId,
            warnAtPercent: [50, 80, 95],
            effectiveFrom: new Date("2026-09-17T00:00:00.000Z"),
          },
        })
      ).id;
      policyVersionBId = (
        await prisma.sLAPolicyVersion.create({
          data: {
            policyId: policy.id,
            version: 2,
            match: {},
            targets: [{ kind: "resolution", minutes: 5 }],
            pauseOnStates: [],
            calendarVersionId,
            warnAtPercent: [50, 80, 95],
            effectiveFrom: new Date("2026-09-17T00:00:00.000Z"),
          },
        })
      ).id;

      const caseRow = await prisma.case.create({
        data: {
          organizationId,
          externalId: "1",
          priority: "urgent",
          openedAt: OPENED,
        },
      });
      caseId = caseRow.id;
      await prisma.normalizedEvent.create({
        data: {
          caseId,
          sourceRawEventId: rawEvent.id,
          type: "case_created",
          occurredAt: OPENED,
          actor: "customer",
          system: "zendesk",
          sourceRole: "ticket_source",
          toState: "open",
        },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("never overwrites a commitment a concurrent process cancelled in between", async () => {
      const commitment = await prisma.commitment.create({
        data: {
          caseId,
          kind: "resolution",
          policyVersionId: policyVersionAId,
          calendarVersionId,
          startedAt: OPENED,
          targetMinutes: 5,
          dueAt: new Date(OPENED.getTime() + 5 * 60_000),
        },
      });

      const originalFindMany = prisma.commitment.findMany.bind(
        prisma.commitment,
      );
      vi.spyOn(prisma.commitment, "findMany").mockImplementationOnce(
        (async (args: Parameters<typeof originalFindMany>[0]) => {
          const rows = await originalFindMany(args);
          // Simulate a concurrent cancellation landing between this read and
          // the pipeline's own write below.
          await prisma.commitment.update({
            where: { id: commitment.id },
            data: { status: "cancelled", closedAt: new Date(AS_OF) },
          });
          return rows;
        }) as unknown as typeof originalFindMany,
      );

      await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: AS_OF,
        scope: "all",
      });

      const row = await prisma.commitment.findUniqueOrThrow({
        where: { id: commitment.id },
      });
      expect(row.status).toBe("cancelled");
      expect(row.closedAt).toEqual(new Date(AS_OF));
    });

    it("never overwrites a commitment that was re-resolved onto a different policy version in between", async () => {
      const commitment = await prisma.commitment.create({
        data: {
          caseId,
          kind: "resolution",
          policyVersionId: policyVersionAId,
          calendarVersionId,
          startedAt: OPENED,
          targetMinutes: 5,
          dueAt: new Date(OPENED.getTime() + 5 * 60_000),
        },
      });

      const originalFindMany = prisma.commitment.findMany.bind(
        prisma.commitment,
      );
      vi.spyOn(prisma.commitment, "findMany").mockImplementationOnce(
        (async (args: Parameters<typeof originalFindMany>[0]) => {
          const rows = await originalFindMany(args);
          // Simulate a concurrent re-resolution moving this commitment onto a
          // different policy version between this read and the pipeline's
          // own write below — the write must not apply a status/closedAt
          // computed against the now-stale version.
          await prisma.commitment.update({
            where: { id: commitment.id },
            data: { policyVersionId: policyVersionBId },
          });
          return rows;
        }) as unknown as typeof originalFindMany,
      );

      await commitments.runEvaluationPipeline(prisma, organizationId, {
        asOf: AS_OF,
        scope: "all",
      });

      const row = await prisma.commitment.findUniqueOrThrow({
        where: { id: commitment.id },
      });
      expect(row.policyVersionId).toBe(policyVersionBId);
      expect(row.status).toBe("on_track");
      expect(row.closedAt).toBeNull();
    });
  },
);
