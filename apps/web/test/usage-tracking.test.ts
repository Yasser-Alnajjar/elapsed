/**
 * N5.7: weekly activity, alert click-through and time to first value are
 * written best-effort and readable from the database. The `openedAt` write is
 * tenant-isolated: a notification id from another organization, or another
 * case, is ignored. Real Postgres; needs a migrated database at
 * TEST_DATABASE_URL whose name contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-02T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe.skipIf(!TEST_DATABASE_URL)("usage instrumentation (real Postgres)", () => {
  let prisma: PrismaClient;
  let usage: typeof import("../src/lib/usage-tracking");
  let admin: typeof import("../src/lib/admin-usage-data");

  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    usage = await import("../src/lib/usage-tracking");
    admin = await import("../src/lib/admin-usage-data");
  });

  beforeEach(async () => {
    usage.resetUsageThrottle();
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    orgA = (await prisma.organization.create({ data: { name: "Alpha", createdAt: ago(10 * DAY) } })).id;
    orgB = (await prisma.organization.create({ data: { name: "Bravo", createdAt: ago(10 * DAY) } })).id;
    userA = (await prisma.user.create({ data: { organizationId: orgA, email: "a@alpha.test", passwordHash: "x" } })).id;
    userB = (await prisma.user.create({ data: { organizationId: orgB, email: "b@bravo.test", passwordHash: "x" } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** A case in `organizationId` with one commitment and one delivered notification. */
  async function seedAlert(organizationId: string, externalId: string, sentAt: Date, channel = "slack") {
    const source = await prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: "zendesk" } },
      create: { organizationId, provider: "zendesk" },
      update: {},
    });
    const caseRow = await prisma.case.create({
      data: { organizationId, system: "zendesk", sourceIntegrationId: source.id, externalId, openedAt: ago(DAY) },
    });
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: `cal-${externalId}`,
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: `p-${externalId}` } });
    const version = await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {},
        targets: [{ kind: "resolution", minutes: 60 }],
        pauseOnStates: [],
        calendarVersionId: calendar.versions[0]!.id,
        warnAtPercent: [80],
        effectiveFrom: ago(2 * DAY),
      },
    });
    const commitment = await prisma.commitment.create({
      data: {
        caseId: caseRow.id,
        kind: "resolution",
        policyVersionId: version.id,
        calendarVersionId: calendar.versions[0]!.id,
        startedAt: ago(DAY),
        targetMinutes: 60,
        dueAt: ago(DAY - HOUR),
      },
    });
    const notification = await prisma.notification.create({ data: { commitmentId: commitment.id, threshold: 80, channel, sentAt } });
    return { caseId: caseRow.id, notificationId: notification.id };
  }

  describe("weekly activity", () => {
    it("stamps a user, then not again within the hour, in memory or in the database", async () => {
      await usage.recordUserSeen(prisma, userA, NOW);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userA } })).lastSeenAt).toEqual(NOW);

      await usage.recordUserSeen(prisma, userA, new Date(NOW.getTime() + 30 * 60_000));
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userA } })).lastSeenAt).toEqual(NOW);

      // Another process with an empty memo still respects the hour, via the conditional update.
      usage.resetUsageThrottle();
      await usage.recordUserSeen(prisma, userA, new Date(NOW.getTime() + 30 * 60_000));
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userA } })).lastSeenAt).toEqual(NOW);

      // The memo holds the last attempt (+30 min), so the next stamp is due an hour after that.
      const later = new Date(NOW.getTime() + 91 * 60_000);
      await usage.recordUserSeen(prisma, userA, later);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userA } })).lastSeenAt).toEqual(later);
    });

    it("never throws into the request", async () => {
      const broken = { user: { updateMany: async () => Promise.reject(new Error("db down")) } } as never;
      await expect(usage.recordUserSeen(broken, "someone", NOW)).resolves.toBeUndefined();
    });
  });

  describe("alert click-through", () => {
    it("records the first open from the same organization, and keeps the first", async () => {
      const { caseId, notificationId } = await seedAlert(orgA, "1", ago(HOUR));

      await usage.recordAlertOpened(prisma, { organizationId: orgA, caseId, notificationId, now: NOW });
      await usage.recordAlertOpened(prisma, { organizationId: orgA, caseId, notificationId, now: new Date(NOW.getTime() + HOUR) });

      expect((await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } })).openedAt).toEqual(NOW);
    });

    it("ignores a notification id that belongs to another organization", async () => {
      const foreign = await seedAlert(orgB, "b1", ago(HOUR));
      const mine = await seedAlert(orgA, "a1", ago(HOUR));

      // A's session opens its own case with B's notification id in the URL.
      await usage.recordAlertOpened(prisma, { organizationId: orgA, caseId: mine.caseId, notificationId: foreign.notificationId, now: NOW });
      // ... or names B's case as well.
      await usage.recordAlertOpened(prisma, { organizationId: orgA, caseId: foreign.caseId, notificationId: foreign.notificationId, now: NOW });

      expect((await prisma.notification.findUniqueOrThrow({ where: { id: foreign.notificationId } })).openedAt).toBeNull();
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: mine.notificationId } })).openedAt).toBeNull();
    });

    it("ignores a notification that belongs to a different case of the same organization", async () => {
      const one = await seedAlert(orgA, "a1", ago(HOUR));
      const two = await seedAlert(orgA, "a2", ago(HOUR));

      await usage.recordAlertOpened(prisma, { organizationId: orgA, caseId: two.caseId, notificationId: one.notificationId, now: NOW });

      expect((await prisma.notification.findUniqueOrThrow({ where: { id: one.notificationId } })).openedAt).toBeNull();
    });

    it("ignores an id that does not exist", async () => {
      const { caseId } = await seedAlert(orgA, "a1", ago(HOUR));
      await expect(usage.recordAlertOpened(prisma, { organizationId: orgA, caseId, notificationId: "nope", now: NOW })).resolves.toBeUndefined();
    });
  });

  describe("time to first value", () => {
    it("is set once, for that organization only", async () => {
      await usage.recordFirstFindingsViewed(prisma, orgA, NOW);
      await usage.recordFirstFindingsViewed(prisma, orgA, new Date(NOW.getTime() + DAY));

      expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgA } })).firstFindingsViewedAt).toEqual(NOW);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgB } })).firstFindingsViewedAt).toBeNull();
    });
  });

  describe("the operator's read model", () => {
    it("reports weekly active organizations, alert click-through and time to first value", async () => {
      await prisma.user.update({ where: { id: userA }, data: { lastSeenAt: ago(2 * DAY) } });
      await prisma.user.update({ where: { id: userB }, data: { lastSeenAt: ago(9 * DAY) } }); // outside the week
      await prisma.organization.update({ where: { id: orgA }, data: { firstFindingsViewedAt: new Date(ago(10 * DAY).getTime() + 25 * 60_000) } });

      const opened = await seedAlert(orgA, "a1", ago(DAY));
      await seedAlert(orgA, "a2", ago(2 * DAY));
      await seedAlert(orgA, "a3", ago(HOUR), "pending"); // a claim in flight is not a delivered alert
      await seedAlert(orgA, "a-old", ago(45 * DAY)); // outside the 30-day window
      await usage.recordAlertOpened(prisma, { organizationId: orgA, caseId: opened.caseId, notificationId: opened.notificationId, now: NOW });

      const data = await admin.getAdminUsageData(prisma, NOW);

      expect(data).toMatchObject({
        organizationCount: 2,
        weeklyActiveOrganizations: 1,
        weeklyActiveUsers: 1,
        alerts: { sent: 2, opened: 1, clickThroughRatio: 0.5 },
        timeToFirstValue: { organizations: 1, medianMinutes: 25 },
      });
      const alpha = data.organizations.find((row) => row.organizationId === orgA)!;
      expect(alpha).toMatchObject({ activeThisWeek: true, alertsSent30d: 2, alertsOpened30d: 1, minutesToFirstValue: 25 });
      const bravo = data.organizations.find((row) => row.organizationId === orgB)!;
      expect(bravo).toMatchObject({ activeThisWeek: false, alertsSent30d: 0, minutesToFirstValue: null });
      // The organization that was not seen this week leads the list.
      expect(data.organizations[0]!.organizationId).toBe(orgB);
    });

    it("has no click-through ratio before any alert was delivered", async () => {
      const data = await admin.getAdminUsageData(prisma, NOW);
      expect(data.alerts).toEqual({ sent: 0, opened: 0, clickThroughRatio: null });
      expect(data.timeToFirstValue).toEqual({ organizations: 0, medianMinutes: null });
    });
  });
});
