/**
 * Notification claim/deliver split (roadmap 7.7 Phase 3, item 7): the claim
 * rows are inserted while the organization lock is held, the Slack/SMTP sends
 * happen after it is released.
 *
 * What has to hold for that to be safe, against the real
 * `@@unique([commitmentId, threshold])` constraint:
 *  - two dispatches racing on the same candidate claim it exactly once, and
 *    only the winner sends;
 *  - a claim whose process died (still `pending`) is released after the stale
 *    window and the alert is retried, not lost;
 *  - a fresh in-flight claim is never released out from under its sender;
 *  - a failed send releases its claim (and records the failure) exactly as
 *    the single-phase pipeline did.
 *
 * Real Postgres; needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test". Skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationCandidate } from "@sla/commitments";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("notification claim/deliver (real Postgres)", () => {
  let prisma: PrismaClient;
  let notifications: typeof import("@sla/notifications");
  let postMessage: ReturnType<typeof vi.fn>;

  let organizationId: string;
  let caseId: string;
  let commitmentId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    notifications = await import("@sla/notifications");
    postMessage = (await import("@sla/slack")).postMessage as ReturnType<typeof vi.fn>;
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    postMessage.mockReset().mockResolvedValue(undefined);

    organizationId = (await prisma.organization.create({ data: { name: "Claim Org" } })).id;
    await prisma.slackIntegration.create({
      data: {
        organizationId,
        accessToken: "xoxb-claim-test",
        teamId: "T1",
        teamName: "Team",
        botUserId: "U1",
        channelId: "C-CLAIM",
      },
    });
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Policy" } });
    const version = await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {},
        targets: [{ kind: "resolution", minutes: 60 }],
        pauseOnStates: [],
        calendarVersionId: calendar.versions[0]!.id,
        warnAtPercent: [80],
        effectiveFrom: new Date("2026-09-17T00:00:00.000Z"),
      },
    });
    caseId = (await prisma.case.create({ data: { organizationId, externalId: "7001", openedAt: new Date() } })).id;
    commitmentId = (
      await prisma.commitment.create({
        data: {
          caseId,
          kind: "resolution",
          policyVersionId: version.id,
          calendarVersionId: calendar.versions[0]!.id,
          startedAt: new Date("2026-09-17T09:00:00.000Z"),
          targetMinutes: 60,
          dueAt: new Date("2026-09-17T10:00:00.000Z"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const candidate = (): NotificationCandidate => ({
    commitmentId,
    caseId,
    kind: "resolution",
    status: "at_risk",
    threshold: 80,
    remainingMinutes: 10,
    policyName: "Policy",
    targetMinutes: 60,
    startedAt: "2026-09-17T09:00:00.000Z",
  });

  it("claiming inserts a pending row and sends nothing; delivering sends and finalizes it", async () => {
    const claims = await notifications.claimNotifications(prisma, organizationId, [candidate()]);

    expect(claims.claimed).toHaveLength(1);
    expect(postMessage).not.toHaveBeenCalled();
    expect(await prisma.notification.findMany({ select: { channel: true } })).toEqual([{ channel: "pending" }]);

    const result = await notifications.deliverClaimedNotifications(prisma, claims);

    expect(result).toMatchObject({ notificationsSent: 1, notificationsFailed: [] });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(await prisma.notification.findMany({ select: { channel: true } })).toEqual([{ channel: "slack" }]);
  });

  it("two concurrent dispatches for the same candidate claim it once and send once", async () => {
    const outcomes = await Promise.all([
      notifications.runNotificationPipeline(prisma, organizationId, [candidate()]),
      notifications.runNotificationPipeline(prisma, organizationId, [candidate()]),
    ]);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(outcomes.reduce((n, o) => n + o.notificationsSent, 0)).toBe(1);
    expect(outcomes.reduce((n, o) => n + o.notificationsSkipped, 0)).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it("two concurrent claims race on the unique constraint: exactly one wins", async () => {
    const [a, b] = await Promise.all([
      notifications.claimNotifications(prisma, organizationId, [candidate()]),
      notifications.claimNotifications(prisma, organizationId, [candidate()]),
    ]);

    expect(a.claimed.length + b.claimed.length).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it("a second cycle skips a candidate whose claim is still in flight", async () => {
    await notifications.claimNotifications(prisma, organizationId, [candidate()]);
    const second = await notifications.claimNotifications(prisma, organizationId, [candidate()]);

    expect(second.claimed).toEqual([]);
    expect(second.skipped).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it("releases a stale pending claim so the alert is retried, not lost", async () => {
    // A process that claimed and then died before sending.
    await notifications.claimNotifications(prisma, organizationId, [candidate()]);
    await prisma.notification.updateMany({
      data: { sentAt: new Date(Date.now() - notifications.STALE_CLAIM_MS - 60_000) },
    });

    const retry = await notifications.runNotificationPipeline(prisma, organizationId, [candidate()]);

    expect(retry.notificationsSent).toBe(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(await prisma.notification.findMany({ select: { channel: true } })).toEqual([{ channel: "slack" }]);
  });

  it("never releases a delivered notification, however old", async () => {
    await notifications.runNotificationPipeline(prisma, organizationId, [candidate()]);
    await prisma.notification.updateMany({
      data: { sentAt: new Date(Date.now() - 10 * notifications.STALE_CLAIM_MS) },
    });
    postMessage.mockClear();

    const again = await notifications.runNotificationPipeline(prisma, organizationId, [candidate()]);

    expect(again.notificationsSent).toBe(0);
    expect(postMessage).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(1);
  });

  it("a failed send releases the claim and records the failure, so the next cycle retries", async () => {
    postMessage.mockRejectedValueOnce(new Error("slack down"));

    const failed = await notifications.runNotificationPipeline(prisma, organizationId, [candidate()]);

    expect(failed.notificationsFailed).toHaveLength(1);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.notificationFailure.count()).toBe(1);

    const retry = await notifications.runNotificationPipeline(prisma, organizationId, [candidate()]);
    expect(retry.notificationsSent).toBe(1);
    expect(await prisma.notificationFailure.count()).toBe(0);
  });
});
