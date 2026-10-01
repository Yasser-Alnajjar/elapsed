/**
 * getCycleTimeAnomalies (performance-plan.md Phase 2 item 3): the candidate
 * query is now bounded to a trailing lookback window instead of scanning
 * every closed commitment the organization has ever had, and the terminal
 * evaluation per commitment comes from a raw `DISTINCT ON` join against
 * `Commitment.closedAt` instead of loading every Evaluation ever recorded
 * and filtering in JS.
 *
 * Real Postgres, like tenant-isolation.test.ts: `DISTINCT ON` and the
 * `evaluatedAt <= closedAt` join condition are exercised against actual SQL,
 * which a fake Prisma can't reproduce faithfully. Needs a migrated database
 * at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function assertDisposableDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${name}". This suite truncates every table, so the name must contain "test".`,
    );
  }
}

const NOW = new Date("2026-09-28T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
// 12 distinct values (detectCycleTimeAnomaly's minimum baseline count) with
// a median of exactly 30 and non-zero spread — all-identical baseline
// samples give a zero MAD, which `detectCycleTimeAnomaly` treats as
// "not enough signal" and never reports an anomaly (packages/core/src/anomaly.ts).
const BASELINE_MINUTES = [26, 27, 28, 29, 29, 30, 30, 31, 32, 33, 34, 35];

describe.skipIf(!TEST_DATABASE_URL)("getCycleTimeAnomalies (real Postgres)", () => {
  let prisma: PrismaClient;
  let getCycleTimeAnomalies: typeof import("../src/lib/anomaly-data").getCycleTimeAnomalies;

  let organizationId: string;
  let customerId: string;
  let policyVersionId: string;
  let calendarVersionId: string;
  let caseCounter: number;

  beforeAll(async () => {
    assertDisposableDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    ({ getCycleTimeAnomalies } = await import("../src/lib/anomaly-data"));
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({
      data: { name: "Anomaly Test Org" },
    });
    organizationId = organization.id;

    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "Always Open",
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
      data: {
        organizationId,
        name: "Policy",
        externalId: "policy-1",
        versions: {
          create: {
            version: 1,
            match: {},
            targets: [{ kind: "first_response", minutes: 30 }],
            pauseOnStates: [],
            calendarVersionId,
            warnAtPercent: [50, 80, 95],
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      },
      include: { versions: true },
    });
    policyVersionId = policy.versions[0]!.id;

    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: "Customer 1",
        identities: { create: { organizationId, provider: "zendesk", kind: "organization", externalId: "zd-org-1" } },
      },
    });
    customerId = customer.id;
    caseCounter = 0;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * A closed, met-or-breached `first_response` commitment for `customerId`,
   * with its terminal Evaluation recorded at close. `extraEvaluation`, when
   * given, is a second Evaluation row recorded later (simulating the
   * reconciliation sweep revising a finalized commitment's status per
   * `evaluate-pipeline.ts`'s "keeps its original closedAt when a later
   * evaluation revises its status") — it must never be picked as terminal.
   */
  async function seedClosedCommitment(opts: {
    closedAt: Date;
    elapsedMinutes: number;
    extraEvaluation?: { evaluatedAt: Date; elapsedMinutes: number };
  }) {
    caseCounter += 1;
    const openedAt = new Date(opts.closedAt.getTime() - 60 * 60_000);
    const caseRow = await prisma.case.create({
      data: {
        organizationId,
        system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"),
        customerId,
        externalId: `case-${caseCounter}`,
        subject: `Case ${caseCounter}`,
        openedAt,
      },
    });
    const commitment = await prisma.commitment.create({
      data: {
        caseId: caseRow.id,
        kind: "first_response",
        policyVersionId,
        calendarVersionId,
        startedAt: openedAt,
        targetMinutes: 30,
        dueAt: new Date(openedAt.getTime() + 30 * 60_000),
        status: "met",
        closedAt: opts.closedAt,
      },
    });
    await prisma.evaluation.create({
      data: {
        commitmentId: commitment.id,
        evaluatedAt: opts.closedAt,
        elapsedSeconds: opts.elapsedMinutes * 60,
        remainingSeconds: 0,
        status: "met",
        inputs: {},
      },
    });
    if (opts.extraEvaluation) {
      await prisma.evaluation.create({
        data: {
          commitmentId: commitment.id,
          evaluatedAt: opts.extraEvaluation.evaluatedAt,
          elapsedSeconds: opts.extraEvaluation.elapsedMinutes * 60,
          remainingSeconds: 0,
          status: "met",
          inputs: {},
        },
      });
    }
    return commitment.id;
  }

  it("flags a sustained slowdown against a stable baseline", async () => {
    // 12 baseline samples (detectCycleTimeAnomaly's minimum), 5 recent ones
    // 10x slower — both requirements for a call, per packages/core/src/anomaly.ts.
    for (let i = 0; i < 12; i++) {
      await seedClosedCommitment({
        closedAt: new Date(NOW.getTime() - (61 - i) * DAY_MS),
        elapsedMinutes: BASELINE_MINUTES[i]!,
      });
    }
    for (let i = 0; i < 5; i++) {
      await seedClosedCommitment({
        closedAt: new Date(NOW.getTime() - (4 - i) * DAY_MS),
        elapsedMinutes: 300,
      });
    }

    const anomalies = await getCycleTimeAnomalies(prisma, organizationId, NOW);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      customerName: "Customer 1",
      kind: "first_response",
      direction: "slower",
      baselineMedianMinutes: 30,
      baselineCount: 12,
      recentMedianMinutes: 300,
      recentCount: 5,
    });
  });

  it("excludes commitments closed before the lookback window from the baseline", async () => {
    // 5 stale commitments well outside the ~180-day lookback: if the query
    // weren't bounded, these would inflate baselineCount past 12.
    for (let i = 0; i < 5; i++) {
      await seedClosedCommitment({
        closedAt: new Date(NOW.getTime() - (250 + i) * DAY_MS),
        elapsedMinutes: 30,
      });
    }
    for (let i = 0; i < 12; i++) {
      await seedClosedCommitment({
        closedAt: new Date(NOW.getTime() - (61 - i) * DAY_MS),
        elapsedMinutes: BASELINE_MINUTES[i]!,
      });
    }
    for (let i = 0; i < 5; i++) {
      await seedClosedCommitment({
        closedAt: new Date(NOW.getTime() - (4 - i) * DAY_MS),
        elapsedMinutes: 300,
      });
    }

    const anomalies = await getCycleTimeAnomalies(prisma, organizationId, NOW);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.baselineCount).toBe(12);
  });

  it("uses the evaluation recorded at close, not a later reconciliation correction", async () => {
    for (let i = 0; i < 12; i++) {
      await seedClosedCommitment({
        closedAt: new Date(NOW.getTime() - (61 - i) * DAY_MS),
        elapsedMinutes: BASELINE_MINUTES[i]!,
      });
    }
    // Each recent commitment's terminal (at-close) evaluation is the 300min
    // slowdown, but a later row claims it was actually fast — if the query
    // picked "latest evaluatedAt" without the `<= closedAt` bound, every
    // recent sample would read back as 30min (indistinguishable from
    // baseline) and no anomaly would fire.
    for (let i = 0; i < 5; i++) {
      const closedAt = new Date(NOW.getTime() - (4 - i) * DAY_MS);
      await seedClosedCommitment({
        closedAt,
        elapsedMinutes: 300,
        extraEvaluation: {
          evaluatedAt: new Date(closedAt.getTime() + 30 * DAY_MS),
          elapsedMinutes: 30,
        },
      });
    }

    const anomalies = await getCycleTimeAnomalies(prisma, organizationId, NOW);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      direction: "slower",
      recentMedianMinutes: 300,
    });
  });
});
