/**
 * N3.5 / D13(b): when the case's source integration is stale,
 *  - an at-risk alert is still sent, labelled with "stale since";
 *  - a breach alert is held (no candidate, nothing sent);
 *  - once the source is fresh again, the same evaluation raises the breach
 *    alert and it is sent exactly once (the held breach is not lost).
 *
 * Real Postgres (evaluation → claim → deliver); Slack is mocked. Needs a
 * migrated database at TEST_DATABASE_URL whose name contains "test"; skipped
 * when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const OPENED = new Date("2026-09-17T09:00:00.000Z");
const TARGET_MINUTES = 100;
const at = (minutesAfterOpen: number) => new Date(OPENED.getTime() + minutesAfterOpen * 60_000);
// 30 s poll × grace 3 = 90 s, the shipped default.
const FRESHNESS = { expectedIntervalMs: 30_000, graceFactor: 3 };

describe.skipIf(!TEST_DATABASE_URL)("stale-source notifications, D13(b) (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");
  let notifications: typeof import("@sla/notifications");
  let postMessage: ReturnType<typeof vi.fn>;

  let organizationId: string;
  let integrationId: string;
  let commitmentId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    commitments = await import("@sla/commitments");
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

    organizationId = (await prisma.organization.create({ data: { name: "Stale Source Org" } })).id;
    await prisma.slackIntegration.create({
      data: {
        organizationId,
        accessToken: "xoxb-stale-test",
        teamId: "T1",
        teamName: "Team",
        botUserId: "U1",
        channelId: "C-STALE",
      },
    });
    // Last successful sync at case open: stale for any asOf past +90 s.
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "zendesk", status: "connected", credentials: {}, lastSuccessfulSyncAt: OPENED },
    });
    integrationId = integration.id;
    const rawEvent = await prisma.rawEvent.create({
      data: { integrationId, providerEventId: "ticket:1", sourceHash: "h", payload: { id: 1 } },
    });
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const calendarVersionId = calendar.versions[0]!.id;
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Policy" } });
    const version = await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {},
        targets: [{ kind: "resolution", minutes: TARGET_MINUTES }],
        pauseOnStates: [],
        calendarVersionId,
        warnAtPercent: [50],
        effectiveFrom: new Date("2026-09-17T00:00:00.000Z"),
      },
    });
    const caseRow = await prisma.case.create({
      data: {
        organizationId,
        system: "zendesk",
        sourceIntegrationId: integrationId,
        externalId: "1",
        priority: "urgent",
        openedAt: OPENED,
      },
    });
    await prisma.normalizedEvent.create({
      data: {
        caseId: caseRow.id,
        sourceRawEventId: rawEvent.id,
        type: "case_created",
        occurredAt: OPENED,
        actor: "customer",
        system: "zendesk",
        sourceRole: "ticket_source",
        toState: "open",
      },
    });
    commitmentId = (
      await prisma.commitment.create({
        data: {
          caseId: caseRow.id,
          kind: "resolution",
          policyVersionId: version.id,
          calendarVersionId,
          startedAt: OPENED,
          targetMinutes: TARGET_MINUTES,
          dueAt: at(TARGET_MINUTES),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Evaluate at `minutes` after open, then dispatch whatever candidates came out. */
  async function evaluateAndNotify(minutes: number) {
    const evaluated = await commitments.runEvaluationPipeline(prisma, organizationId, {
      asOf: at(minutes).toISOString(),
      scope: "all",
      freshness: FRESHNESS,
    });
    const sent = await notifications.runNotificationPipeline(prisma, organizationId, evaluated.notificationCandidates);
    return { evaluated, sent };
  }

  const slackText = () => JSON.stringify(postMessage.mock.calls.map((call) => call.slice(1)));

  it("sends a stale at-risk alert, labelled with when the data went stale", async () => {
    const { evaluated, sent } = await evaluateAndNotify(60); // 60% of target: crosses the 50% warning

    expect(evaluated.notificationCandidates).toHaveLength(1);
    expect(evaluated.notificationCandidates[0]).toMatchObject({ threshold: 50, sourceStaleSince: at(1.5).toISOString() });
    expect(sent.notificationsSent).toBe(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(slackText()).toContain("Source data stale since");
  });

  it("does not label an at-risk alert when the source is fresh", async () => {
    await prisma.integration.update({ where: { id: integrationId }, data: { lastSuccessfulSyncAt: at(60) } });

    const { evaluated } = await evaluateAndNotify(60);

    expect(evaluated.notificationCandidates[0]).toMatchObject({ threshold: 50, sourceStaleSince: null });
    expect(slackText()).not.toContain("stale");
  });

  it("holds a breach alert while the source is stale, but still records the evaluation with the stale marker", async () => {
    const { evaluated, sent } = await evaluateAndNotify(110); // past the 100-minute target

    expect(evaluated.notificationCandidates.filter((c) => c.threshold === 100)).toEqual([]);
    expect(sent.notificationsSent).toBe(evaluated.notificationCandidates.length); // only any at-risk alert
    expect(await prisma.notification.count({ where: { threshold: 100 } })).toBe(0);
    const evaluation = await prisma.evaluation.findFirstOrThrow({ where: { commitmentId } });
    expect(evaluation.status).toBe("breached"); // SLA math is untouched by staleness
    expect(evaluation.sourceStaleSince).toEqual(at(1.5));
  });

  it("sends the held breach alert exactly once after the source becomes fresh", async () => {
    await evaluateAndNotify(110);
    expect(await prisma.notification.count({ where: { threshold: 100 } })).toBe(0);

    // The source recovers; the next evaluation must still raise the breach.
    await prisma.integration.update({ where: { id: integrationId }, data: { lastSuccessfulSyncAt: at(111) } });
    const recovered = await commitments.runEvaluationPipeline(prisma, organizationId, {
      asOf: at(111).toISOString(),
      scope: "all",
      freshness: FRESHNESS,
    });
    expect(recovered.notificationCandidates.filter((c) => c.threshold === 100)).toHaveLength(1);
    await notifications.runNotificationPipeline(prisma, organizationId, recovered.notificationCandidates);
    expect(await prisma.notification.count({ where: { threshold: 100 } })).toBe(1);

    // And it is not re-sent by a later evaluation.
    const again = await commitments.runEvaluationPipeline(prisma, organizationId, {
      asOf: at(112).toISOString(),
      scope: "all",
      freshness: FRESHNESS,
    });
    await prisma.integration.update({ where: { id: integrationId }, data: { lastSuccessfulSyncAt: at(112) } });
    await notifications.runNotificationPipeline(prisma, organizationId, again.notificationCandidates);
    expect(await prisma.notification.count({ where: { threshold: 100 } })).toBe(1);
  });
});
