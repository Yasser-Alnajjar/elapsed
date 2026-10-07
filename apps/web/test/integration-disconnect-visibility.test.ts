/**
 * Disconnecting an integration is a soft state: nothing is deleted, the
 * `Integration` row stays, and everything derived from it disappears from the
 * application until the integration is reconnected.
 *
 * Real Postgres, because the behaviour lives in Prisma relation filters that
 * a fake would only re-implement. Needs a migrated database at
 * TEST_DATABASE_URL whose name contains "test" (every test truncates all
 * tables). Skipped when unset.
 *
 * Two shapes of integration are covered:
 *  - a ticket source (a case's `sourceIntegration`): disconnecting hides its
 *    cases and, through them, commitments, evaluations, events, links and alerts;
 *  - an issue tracker (`CaseLink.system` / `NormalizedEvent.system`): the ticket
 *    case stays, but links and events from the tracker disappear.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationCandidate } from "@sla/commitments";

vi.mock("server-only", () => ({}));
vi.mock("@sla/slack", () => ({ postMessage: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-01T12:00:00.000Z");

interface Seeded {
  organizationId: string;
  caseId: string;
  openCommitmentId: string;
  zendeskId: string;
  jiraId: string;
}

describe.skipIf(!TEST_DATABASE_URL)("integration disconnect visibility (real Postgres)", () => {
  let prisma: PrismaClient;
  let lib: {
    getDashboardData: typeof import("../src/lib/dashboard-data").getDashboardData;
    getCaseListData: typeof import("../src/lib/case-list-data").getCaseListData;
    getCaseDetailData: typeof import("../src/lib/case-detail-data").getCaseDetailData;
    getAtRiskData: typeof import("../src/lib/at-risk-data").getAtRiskData;
    getAlertSummary: typeof import("../src/lib/alert-summary-data").getAlertSummary;
    getFindingsData: typeof import("../src/lib/findings-data").getFindingsData;
    getComplianceReportRows: typeof import("../src/lib/report-data").getComplianceReportRows;
    getLinkCoverage: typeof import("../src/lib/link-coverage-data").getLinkCoverage;
    getOnboardingStatus: typeof import("../src/lib/onboarding-data").getOnboardingStatus;
  };
  let commitments: typeof import("@sla/commitments");
  let notifications: typeof import("@sla/notifications");
  let a: Seeded;
  let b: Seeded;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    lib = {
      ...(await import("../src/lib/dashboard-data")),
      ...(await import("../src/lib/case-list-data")),
      ...(await import("../src/lib/case-detail-data")),
      ...(await import("../src/lib/at-risk-data")),
      ...(await import("../src/lib/alert-summary-data")),
      ...(await import("../src/lib/findings-data")),
      ...(await import("../src/lib/report-data")),
      ...(await import("../src/lib/link-coverage-data")),
      ...(await import("../src/lib/onboarding-data")),
    };
    commitments = await import("@sla/commitments");
    notifications = await import("@sla/notifications");
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seedOrg(label: string): Promise<Seeded> {
    const openedAt = new Date(NOW.getTime() - 2 * 3_600_000);
    const { id: organizationId } = await prisma.organization.create({ data: { name: `${label} Org` } });

    const zendesk = await prisma.integration.create({ data: { organizationId, provider: "zendesk", credentials: {} } });
    const jira = await prisma.integration.create({ data: { organizationId, provider: "jira", credentials: {} } });
    const zendeskRaw = await prisma.rawEvent.create({
      data: { integrationId: zendesk.id, providerEventId: `${label}-ticket:1`, sourceHash: "h", payload: {} },
    });
    const jiraRaw = await prisma.rawEvent.create({
      data: { integrationId: jira.id, providerEventId: `${label}-issue:1`, sourceHash: "h", payload: {} },
    });

    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: `${label} calendar`,
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const calendarVersionId = calendar.versions[0]!.id;
    const policy = await prisma.sLAPolicy.create({
      data: {
        organizationId,
        name: `${label} policy`,
        versions: {
          create: {
            version: 1,
            match: {},
            targets: [{ kind: "first_response", minutes: 30 }, { kind: "resolution", minutes: 240 }],
            pauseOnStates: ["pending_customer"],
            calendarVersionId,
            warnAtPercent: [50, 80, 95],
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      },
      include: { versions: true },
    });
    const policyVersionId = policy.versions[0]!.id;

    const caseRow = await prisma.case.create({
      data: {
        organizationId,
        system: "zendesk",
        sourceIntegrationId: zendesk.id,
        externalId: `${label}-ticket-1`,
        subject: `${label} subject`,
        priority: "urgent",
        openedAt,
        caseLinks: {
          create: { system: "jira", externalId: `${label}-1`, method: "remote_link", confidence: "certain" },
        },
        normalizedEvents: {
          create: [
            {
              sourceRawEventId: zendeskRaw.id,
              type: "case_created",
              occurredAt: openedAt,
              actor: "agent",
              system: "zendesk",
              sourceRole: "ticket_source",
              toState: "new",
            },
            {
              sourceRawEventId: jiraRaw.id,
              type: "state_changed",
              occurredAt: new Date(openedAt.getTime() + 60_000),
              actor: "engineer",
              system: "jira",
              sourceRole: "work_tracker",
              toState: "in_progress",
            },
          ],
        },
      },
    });

    // An open commitment that is about to breach (shows up on the at-risk
    // views and can raise an alert), and a finalized breached one with its
    // evaluation (shows up in reports and breach counts).
    const open = await prisma.commitment.create({
      data: {
        caseId: caseRow.id,
        kind: "resolution",
        policyVersionId,
        calendarVersionId,
        startedAt: openedAt,
        targetMinutes: 240,
        dueAt: new Date(NOW.getTime() + 20 * 60_000),
        status: "at_risk",
      },
    });
    const closed = await prisma.commitment.create({
      data: {
        caseId: caseRow.id,
        kind: "first_response",
        policyVersionId,
        calendarVersionId,
        startedAt: openedAt,
        targetMinutes: 30,
        dueAt: new Date(openedAt.getTime() + 30 * 60_000),
        status: "breached",
        closedAt: new Date(openedAt.getTime() + 45 * 60_000),
      },
    });
    await prisma.evaluation.create({
      data: {
        commitmentId: closed.id,
        evaluatedAt: new Date(openedAt.getTime() + 45 * 60_000),
        elapsedSeconds: 45 * 60,
        remainingSeconds: -15 * 60,
        breachedBySeconds: 15 * 60,
        breachedAt: new Date(openedAt.getTime() + 30 * 60_000),
        status: "breached",
        inputs: {},
      },
    });
    await prisma.notificationFailure.create({ data: { commitmentId: open.id, threshold: 80, error: "boom" } });

    return { organizationId, caseId: caseRow.id, openCommitmentId: open.id, zendeskId: zendesk.id, jiraId: jira.id };
  }

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    a = await seedOrg("ALPHA");
    b = await seedOrg("BRAVO");
  });

  /** What the disconnect route does to the row (minus clearing credentials, which reconnect re-supplies). */
  const disconnect = (integrationId: string) =>
    prisma.integration.update({ where: { id: integrationId }, data: { status: "disconnected", disconnectedAt: new Date() } });
  /** What the OAuth callback does on reconnect. */
  const reconnect = (integrationId: string) =>
    prisma.integration.update({ where: { id: integrationId }, data: { status: "connected", disconnectedAt: null } });

  /** Every app-facing read for one organization, at a fixed instant. */
  async function snapshot(organizationId: string, caseId: string) {
    return {
      dashboard: await lib.getDashboardData(prisma, organizationId, NOW),
      list: await lib.getCaseListData(prisma, organizationId, {}, NOW),
      listLinked: await lib.getCaseListData(prisma, organizationId, { linkState: "linked" }, NOW),
      detail: await lib.getCaseDetailData(prisma, organizationId, caseId, NOW),
      atRisk: await lib.getAtRiskData(prisma, organizationId, {}, NOW),
      alerts: await lib.getAlertSummary(prisma, organizationId, NOW),
      findings: await lib.getFindingsData(prisma, organizationId, NOW),
      report: await lib.getComplianceReportRows(prisma, organizationId, NOW),
      coverage: [...(await lib.getLinkCoverage(prisma, { organizationIds: [organizationId], now: NOW })).entries()],
      onboarding: await lib.getOnboardingStatus(prisma, organizationId),
    };
  }

  /** Row counts of every table the integration's data lives in: disconnect must never change them. */
  const rowCounts = async () => ({
    integrations: await prisma.integration.count(),
    rawEvents: await prisma.rawEvent.count(),
    normalizedEvents: await prisma.normalizedEvent.count(),
    cases: await prisma.case.count(),
    caseLinks: await prisma.caseLink.count(),
    commitments: await prisma.commitment.count(),
    evaluations: await prisma.evaluation.count(),
    notificationFailures: await prisma.notificationFailure.count(),
  });

  describe("ticket source", () => {
    it("hides its cases and everything derived from them, then restores them on reconnect, deleting nothing", async () => {
      const before = await snapshot(a.organizationId, a.caseId);
      const counts = await rowCounts();

      // Sanity: the seed is visible to start with, or the rest proves nothing.
      expect(before.list.cases.map((c) => c.caseId)).toEqual([a.caseId]);
      expect(before.detail).not.toBeNull();
      expect(before.atRisk.rows.length).toBeGreaterThan(0);
      expect(before.alerts.totalCount).toBeGreaterThan(0);
      expect(before.report.length).toBeGreaterThan(0);
      expect(before.dashboard.failedAlerts.length).toBeGreaterThan(0);
      expect(before.findings.totalEscalated).toBeGreaterThan(0);

      await disconnect(a.zendeskId);
      const during = await snapshot(a.organizationId, a.caseId);

      expect(during.list.cases).toEqual([]);
      expect(during.list.counts.status.all).toBe(0);
      expect(during.listLinked.cases).toEqual([]);
      expect(during.detail).toBeNull();
      expect(during.atRisk.rows).toEqual([]);
      expect(during.atRisk.totalCount).toBe(0);
      expect(during.alerts.totalCount).toBe(0);
      expect(during.report).toEqual([]);
      expect(during.findings.totalEscalated).toBe(0);
      expect(during.dashboard.atRisk).toEqual([]);
      expect(during.dashboard.breachedThisPeriod.total).toBe(0);
      expect(during.dashboard.failedAlerts).toEqual([]);
      expect(during.dashboard.unmatchedCases).toEqual([]);
      expect(during.onboarding.ticketsFetched).toBe(0);
      expect(during.onboarding.linkedIssues).toBe(0);
      expect(during.coverage).toEqual([[a.organizationId, { cases: 0, linkedCases: 0, ratio: null }]]);
      // The integration itself stays (still listed, marked disconnected) so it can be reconnected.
      expect(during.dashboard.integrationHealth.map((i) => i.provider)).toContain("zendesk");
      expect(await prisma.integration.findUnique({ where: { id: a.zendeskId }, select: { status: true } })).toEqual({
        status: "disconnected",
      });

      expect(await rowCounts()).toEqual(counts);

      await reconnect(a.zendeskId);
      expect(await snapshot(a.organizationId, a.caseId)).toEqual(before);
    });

    it("does not touch another organization's data", async () => {
      const bravoBefore = await snapshot(b.organizationId, b.caseId);
      await disconnect(a.zendeskId);
      expect(await snapshot(b.organizationId, b.caseId)).toEqual(bravoBefore);
    });

    it("is not evaluated or alerted on while disconnected, and resumes on reconnect", async () => {
      await disconnect(a.zendeskId);
      const hidden = await commitments.runEvaluationPipeline(prisma, a.organizationId, { asOf: NOW.toISOString() });
      expect(hidden.commitmentsConsidered).toBe(0);
      expect(hidden.notificationCandidates).toEqual([]);

      // Even a candidate that reached dispatch is dropped without consuming its claim.
      await prisma.slackIntegration.create({
        data: { organizationId: a.organizationId, accessToken: "xoxb-test", teamId: "T", teamName: "T", botUserId: "U", channelId: "C" },
      });
      const candidate: NotificationCandidate = {
        commitmentId: a.openCommitmentId,
        caseId: a.caseId,
        kind: "resolution",
        status: "at_risk",
        threshold: 80,
        remainingMinutes: 20,
        policyName: "p",
        targetMinutes: 240,
        startedAt: NOW.toISOString(),
      };
      const claims = await notifications.claimNotifications(prisma, a.organizationId, [candidate]);
      expect(claims.claimed).toEqual([]);
      expect(await prisma.notification.count()).toBe(0);

      await reconnect(a.zendeskId);
      const resumed = await commitments.runEvaluationPipeline(prisma, a.organizationId, { asOf: NOW.toISOString() });
      expect(resumed.commitmentsConsidered).toBeGreaterThan(0);
      const claimsAfter = await notifications.claimNotifications(prisma, a.organizationId, [candidate]);
      expect(claimsAfter.claimed).toHaveLength(1);
    });

    it("keeps a case with no recorded source integration visible", async () => {
      await prisma.case.update({ where: { id: a.caseId }, data: { sourceIntegrationId: null } });
      await disconnect(a.zendeskId);
      const list = await lib.getCaseListData(prisma, a.organizationId, {}, NOW);
      expect(list.cases.map((c) => c.caseId)).toEqual([a.caseId]);
    });
  });

  describe("issue tracker", () => {
    it("hides its links and events but keeps the ticket case, then restores them on reconnect", async () => {
      const before = await snapshot(a.organizationId, a.caseId);
      const counts = await rowCounts();
      expect(before.detail!.links.map((l) => l.system)).toEqual(["jira"]);
      expect(before.detail!.timeline.some((e) => e.system === "jira")).toBe(true);
      expect(before.listLinked.cases).toHaveLength(1);
      expect(before.findings.totalEscalated).toBe(1);

      await disconnect(a.jiraId);
      const during = await snapshot(a.organizationId, a.caseId);

      // The ticket and its commitments are untouched...
      expect(during.list.cases.map((c) => c.caseId)).toEqual([a.caseId]);
      expect(during.detail).not.toBeNull();
      expect(during.report.length).toBe(before.report.length);
      // ...but nothing the tracker contributed remains.
      expect(during.detail!.links).toEqual([]);
      expect(during.detail!.timeline.some((e) => e.system === "jira")).toBe(false);
      expect(during.listLinked.cases).toEqual([]);
      expect(during.list.cases[0]!.primaryLink).toBeNull();
      expect(during.findings.totalEscalated).toBe(0);
      expect(during.onboarding.linkedIssues).toBe(0);
      expect(during.onboarding.escalatedCases).toBe(0);
      expect(during.dashboard.engineeringMeasured).toBe(false);
      expect(during.dashboard.totalEscalated.count).toBe(0);

      expect(await rowCounts()).toEqual(counts);

      await reconnect(a.jiraId);
      expect(await snapshot(a.organizationId, a.caseId)).toEqual(before);
    });

    it("is scoped to the organization that disconnected it", async () => {
      const bravoBefore = await snapshot(b.organizationId, b.caseId);
      await disconnect(a.jiraId);
      const bravoDuring = await snapshot(b.organizationId, b.caseId);
      expect(bravoDuring.detail!.links.map((l) => l.system)).toEqual(["jira"]);
      expect(bravoDuring).toEqual(bravoBefore);
    });
  });
});
