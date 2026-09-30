/**
 * CSV export keyset-pagination completeness (performance-plan.md Phase 2
 * item 5): `iterateComplianceReportRows` must return exactly the same rows
 * — no duplicates, none skipped — no matter what batch size it's driven
 * with. Isolation and row-shape correctness are already covered by
 * `tenant-isolation.test.ts`'s "compliance report helper and CSV export
 * route" case; this suite is only about the batching itself, so it needs
 * enough commitments to force several batches (including cases that tie on
 * `case.openedAt`, the keyset's primary sort key) and real Postgres, since
 * the keyset filter is a nested relation `where`/`orderBy` a fake Prisma
 * would just be re-testing itself against (see tenant-isolation.test.ts's
 * own note).
 *
 * Needs a migrated Postgres at TEST_DATABASE_URL (see README "Tests and
 * type checks"). Skipped when unset. The database name must contain "test",
 * because this suite truncates all tables.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function assertDisposableDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${name}". This suite truncates every table, so the name must contain "test".`,
    );
  }
}

const ORG_LABEL = "report-batching";
const CASE_COUNT = 23; // deliberately not a multiple of any batch size below
const OPENED_AT_TIE_GROUPS = 4; // several cases share the same openedAt, forcing the id tie-breaker

describe.skipIf(!TEST_DATABASE_URL)(
  "CSV export keyset pagination (real Postgres)",
  () => {
    let prisma: PrismaClient;
    let organizationId: string;
    let expectedKeys: Set<string>;
    let iterateComplianceReportRows: typeof import("../src/lib/report-data").iterateComplianceReportRows;
    let complianceReportRowsToJsonChunk: typeof import("../src/lib/report-data").complianceReportRowsToJsonChunk;

    beforeAll(async () => {
      assertDisposableDatabase(TEST_DATABASE_URL!);
      process.env.DATABASE_URL = TEST_DATABASE_URL;

      prisma = (await import("@sla/db")).getPrismaClient();
      ({ iterateComplianceReportRows, complianceReportRowsToJsonChunk } =
        await import("../src/lib/report-data"));
    });

    beforeEach(async () => {
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
      );

      const organization = await prisma.organization.create({
        data: { name: `${ORG_LABEL} Org` },
      });
      organizationId = organization.id;

      const calendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          name: "Always open",
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
      const calendarVersionId = calendar.versions[0]!.id;

      const policy = await prisma.sLAPolicy.create({
        data: {
          organizationId,
          name: "Default",
          externalId: "default-policy",
          versions: {
            create: {
              version: 1,
              match: {},
              targets: [
                { kind: "first_response", minutes: 30 },
                { kind: "resolution", minutes: 240 },
              ],
              pauseOnStates: [],
              calendarVersionId,
              warnAtPercent: [50, 80, 95],
              effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            },
          },
        },
        include: { versions: true },
      });
      const policyVersionId = policy.versions[0]!.id;

      const customer = await prisma.customer.create({
        data: { organizationId, name: "Acme" },
      });

      const baseOpenedAt = new Date("2026-09-01T00:00:00.000Z");
      const keys: string[] = [];

      for (let i = 0; i < CASE_COUNT; i++) {
        // Several cases share the same openedAt (the keyset's primary sort
        // key), so completeness only holds if the `id` tie-breaker works.
        const openedAt = new Date(
          baseOpenedAt.getTime() +
            (i % OPENED_AT_TIE_GROUPS) * 24 * 3_600_000,
        );
        const externalId = `ticket-${i}`;
        const caseRow = await prisma.case.create({
          data: {
            organizationId,
            system: "zendesk",
            customerId: customer.id,
            externalId,
            openedAt,
          },
        });

        // Alternate open (live-evaluated) and closed (persisted evaluation)
        // commitments, so both code paths get batched.
        if (i % 2 === 0) {
          await prisma.commitment.create({
            data: {
              caseId: caseRow.id,
              kind: "resolution",
              policyVersionId,
              calendarVersionId,
              startedAt: openedAt,
              targetMinutes: 240,
              dueAt: new Date(openedAt.getTime() + 240 * 60_000),
            },
          });
        } else {
          const closedAt = new Date(openedAt.getTime() + 45 * 60_000);
          const commitment = await prisma.commitment.create({
            data: {
              caseId: caseRow.id,
              kind: "first_response",
              policyVersionId,
              calendarVersionId,
              startedAt: openedAt,
              targetMinutes: 30,
              dueAt: new Date(openedAt.getTime() + 30 * 60_000),
              status: "breached",
              closedAt,
            },
          });
          await prisma.evaluation.create({
            data: {
              commitmentId: commitment.id,
              evaluatedAt: closedAt,
              elapsedSeconds: 45 * 60,
              remainingSeconds: -15 * 60,
              breachedBySeconds: 15 * 60,
              status: "breached",
              inputs: {},
            },
          });
        }

        keys.push(externalId);
      }

      expectedKeys = new Set(keys);
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    async function collectKeys(batchSize: number): Promise<string[]> {
      const keys: string[] = [];
      let batchCount = 0;
      for await (const batch of iterateComplianceReportRows(
        prisma,
        organizationId,
        new Date("2026-09-10T00:00:00.000Z"),
        batchSize,
      )) {
        batchCount += 1;
        expect(batch.length).toBeLessThanOrEqual(batchSize);
        for (const row of batch) keys.push(row.externalId);
      }
      if (CASE_COUNT > batchSize) {
        expect(batchCount).toBeGreaterThan(1);
      }
      return keys;
    }

    it.each([1, 7, 1000])(
      "batch size %i returns every row exactly once",
      async (batchSize) => {
        const keys = await collectKeys(batchSize);
        expect(keys).toHaveLength(CASE_COUNT);
        expect(new Set(keys)).toEqual(expectedKeys);
        // No duplicates: a Set built from the keys is the same size as the array.
        expect(new Set(keys).size).toBe(keys.length);
      },
    );

    it("returns the same rows regardless of batch size", async () => {
      const [batchOf1, batchOf7, batchOf1000] = await Promise.all([
        collectKeys(1),
        collectKeys(7),
        collectKeys(1000),
      ]);
      expect([...batchOf1].sort()).toEqual([...batchOf7].sort());
      expect([...batchOf7].sort()).toEqual([...batchOf1000].sort());
    });

    it.each([1, 7, 1000])(
      "JSON streaming with batch size %i assembles into one valid array with every row",
      async (batchSize) => {
        let json = "[";
        let isFirstBatch = true;
        for await (const batch of iterateComplianceReportRows(
          prisma,
          organizationId,
          new Date("2026-09-10T00:00:00.000Z"),
          batchSize,
        )) {
          json += complianceReportRowsToJsonChunk(batch, isFirstBatch);
          isFirstBatch = false;
        }
        json += "]";

        const parsed = JSON.parse(json) as { externalId: string }[];
        expect(parsed).toHaveLength(CASE_COUNT);
        expect(new Set(parsed.map((row) => row.externalId))).toEqual(
          expectedKeys,
        );
      },
    );
  },
);
