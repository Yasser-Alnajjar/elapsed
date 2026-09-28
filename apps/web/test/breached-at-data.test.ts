/**
 * getPersistedBreachedAt (performance-plan.md Phase 2 item 2): the dashboard's
 * "breachedAt" for a breached commitment is the `Evaluation.breachedAt`
 * recorded on the earliest persisted `"breached"` Evaluation row that has
 * one, read via a `DISTINCT ON` query — not a live, calendar-aware
 * re-simulation of `computeBreachedAt` over the commitment's full event
 * history. This suite is the DB-backed half of that; findBreachesInPeriod's
 * period filtering and dueAt fallback are covered as pure functions in
 * analytics-data.test.ts.
 *
 * `breachedAt` is deliberately its own column, separate from `evaluatedAt`:
 * `evaluatedAt` is only when the row was computed (a poll cycle, a
 * reconciliation sweep, or a one-off historical import), which can land
 * arbitrarily later than the real SLA-clock-crossing instant — see "uses
 * breachedAt, not evaluatedAt, when they differ" below for the regression
 * this column exists to fix.
 *
 * Real Postgres, like anomaly-data.test.ts: `DISTINCT ON` is exercised against
 * actual SQL, which a fake Prisma can't reproduce faithfully. Needs a migrated
 * database at TEST_DATABASE_URL whose name contains "test"; skipped when unset.
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

describe.skipIf(!TEST_DATABASE_URL)("getPersistedBreachedAt (real Postgres)", () => {
  let prisma: PrismaClient;
  let getPersistedBreachedAt: typeof import("../src/lib/analytics-data").getPersistedBreachedAt;

  let organizationId: string;
  let customerId: string;
  let policyVersionId: string;
  let calendarVersionId: string;
  let caseCounter: number;

  beforeAll(async () => {
    assertDisposableDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    ({ getPersistedBreachedAt } = await import("../src/lib/analytics-data"));
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({
      data: { name: "Breached-At Test Org" },
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
      data: { organizationId, name: "Customer 1", zendeskOrgId: "zd-org-1" },
    });
    customerId = customer.id;
    caseCounter = 0;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seedCommitment(opts: { dueAt: Date; closedAt?: Date }) {
    caseCounter += 1;
    const openedAt = new Date(opts.dueAt.getTime() - 30 * 60_000);
    const caseRow = await prisma.case.create({
      data: {
        organizationId,
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
        dueAt: opts.dueAt,
        status: "breached",
        closedAt: opts.closedAt,
      },
    });
    return commitment.id;
  }

  async function addEvaluation(
    commitmentId: string,
    evaluatedAt: Date,
    status: "on_track" | "at_risk" | "breached",
    breachedAt?: Date,
  ) {
    await prisma.evaluation.create({
      data: {
        commitmentId,
        evaluatedAt,
        elapsedSeconds: 0,
        remainingSeconds: 0,
        status,
        breachedAt: status === "breached" ? (breachedAt ?? evaluatedAt) : null,
        inputs: {},
      },
    });
  }

  it("returns the earliest breached Evaluation's breachedAt, not a later one", async () => {
    const dueAt = new Date("2026-09-10T00:30:00.000Z");
    const commitmentId = await seedCommitment({ dueAt });
    // Worker cycles: on_track, then breached at the true instant, then
    // breached again on a later reconciliation sweep — the earliest breached
    // row is the one that counts, and its breachedAt is the real crossing
    // instant regardless of which cycle recomputed it.
    await addEvaluation(commitmentId, new Date("2026-09-10T00:00:00.000Z"), "on_track");
    await addEvaluation(commitmentId, new Date("2026-09-10T00:35:00.000Z"), "breached", dueAt);
    await addEvaluation(commitmentId, new Date("2026-09-17T12:00:00.000Z"), "breached", dueAt);

    const result = await getPersistedBreachedAt(prisma, [commitmentId]);

    expect(result.get(commitmentId)?.toISOString()).toBe(dueAt.toISOString());
  });

  it("uses breachedAt, not evaluatedAt, when they differ (historical import / backfill)", async () => {
    // The bug this column exists to fix: an org's backlog is imported and
    // evaluated for the first time on 2026-09-28, long after the commitment
    // actually breached on 2026-09-21. evaluatedAt is the import day for
    // every such row; breachedAt is the true, spread-out crossing instant.
    const trueBreachInstant = new Date("2026-09-21T22:38:16.000Z");
    const importDay = new Date("2026-09-28T10:38:14.539Z");
    const commitmentId = await seedCommitment({
      dueAt: trueBreachInstant,
      closedAt: importDay,
    });
    await addEvaluation(commitmentId, importDay, "breached", trueBreachInstant);

    const result = await getPersistedBreachedAt(prisma, [commitmentId]);

    expect(result.get(commitmentId)?.toISOString()).toBe(trueBreachInstant.toISOString());
    expect(result.get(commitmentId)?.toISOString()).not.toBe(importDay.toISOString());
  });

  it("omits a commitment with no breached Evaluation row", async () => {
    const commitmentId = await seedCommitment({ dueAt: new Date("2026-09-10T00:30:00.000Z") });
    await addEvaluation(commitmentId, new Date("2026-09-10T00:00:00.000Z"), "at_risk");

    const result = await getPersistedBreachedAt(prisma, [commitmentId]);

    expect(result.has(commitmentId)).toBe(false);
  });

  it("omits a commitment whose breached Evaluation predates the breachedAt column (not yet backfilled)", async () => {
    const commitmentId = await seedCommitment({ dueAt: new Date("2026-09-10T00:30:00.000Z") });
    // Directly write a row with breachedAt left null, mimicking a
    // pre-migration Evaluation that hasn't run through the backfill script.
    await prisma.evaluation.create({
      data: {
        commitmentId,
        evaluatedAt: new Date("2026-09-10T00:35:00.000Z"),
        elapsedSeconds: 0,
        remainingSeconds: 0,
        status: "breached",
        breachedAt: null,
        inputs: {},
      },
    });

    const result = await getPersistedBreachedAt(prisma, [commitmentId]);

    expect(result.has(commitmentId)).toBe(false);
  });

  it("stays immutable across a later re-evaluation (reconciliation can't move it)", async () => {
    const dueAt = new Date("2026-09-10T00:30:00.000Z");
    const commitmentId = await seedCommitment({ dueAt });
    await addEvaluation(commitmentId, new Date("2026-09-10T00:35:00.000Z"), "breached", dueAt);

    const before = await getPersistedBreachedAt(prisma, [commitmentId]);
    await addEvaluation(commitmentId, new Date("2026-09-20T09:00:00.000Z"), "breached", dueAt);
    const after = await getPersistedBreachedAt(prisma, [commitmentId]);

    expect(after.get(commitmentId)?.toISOString()).toBe(before.get(commitmentId)?.toISOString());
    expect(after.get(commitmentId)?.toISOString()).toBe(dueAt.toISOString());
  });

  it("resolves each commitment independently across several candidates", async () => {
    const c1 = await seedCommitment({ dueAt: new Date("2026-09-10T00:30:00.000Z") });
    const c2 = await seedCommitment({ dueAt: new Date("2026-09-11T00:30:00.000Z") });
    await addEvaluation(c1, new Date("2026-09-10T00:35:00.000Z"), "breached", new Date("2026-09-10T00:30:00.000Z"));
    await addEvaluation(c2, new Date("2026-09-11T00:40:00.000Z"), "breached", new Date("2026-09-11T00:30:00.000Z"));

    const result = await getPersistedBreachedAt(prisma, [c1, c2]);

    expect(result.get(c1)?.toISOString()).toBe("2026-09-10T00:30:00.000Z");
    expect(result.get(c2)?.toISOString()).toBe("2026-09-11T00:30:00.000Z");
  });

  it("returns an empty map for an empty commitment id list without querying", async () => {
    const result = await getPersistedBreachedAt(prisma, []);
    expect(result.size).toBe(0);
  });
});
