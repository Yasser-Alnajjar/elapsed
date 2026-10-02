/**
 * N5.2: an organization with a ticket source and no work tracker gets
 * support-side findings and an explicit "no tracker yet" state. Engineering
 * time is never printed as a measured zero, and no leg is `engineering`
 * without a link that established it.
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("partial value before a tracker is connected (real Postgres)", () => {
  let prisma: PrismaClient;
  let zendesk: typeof import("@sla/zendesk");
  let jira: typeof import("@sla/jira");
  let sourceSync: typeof import("../src/lib/source-sync");
  let findings: typeof import("../src/lib/findings-data");
  let dashboard: typeof import("../src/lib/dashboard-data");

  let organizationId: string;
  let sourceId: string;
  const done = { backfillCompletedAt: new Date().toISOString() };
  const openedAt = new Date(Date.now() - 20 * 60_000);

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    zendesk = await import("@sla/zendesk");
    jira = await import("@sla/jira");
    sourceSync = await import("../src/lib/source-sync");
    findings = await import("../src/lib/findings-data");
    dashboard = await import("../src/lib/dashboard-data");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    organizationId = (await prisma.organization.create({ data: { name: "Partial Value Org" } })).id;
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Default" } });
    await prisma.sLAPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        match: {},
        targets: [
          { kind: "first_response", minutes: 30 },
          { kind: "resolution", minutes: 120 },
        ],
        pauseOnStates: [],
        calendarVersionId: calendar.versions[0]!.id,
        warnAtPercent: [50, 80, 95],
        effectiveFrom: new Date(Date.now() - 24 * 60 * 60_000),
      },
    });
    sourceId = (
      await prisma.integration.create({
        data: { organizationId, provider: "zendesk", status: "connected", credentials: { subdomain: "pv" }, cursor: done, lastSuccessfulSyncAt: new Date() },
      })
    ).id;
    await prisma.rawEvent.create({
      data: {
        integrationId: sourceId,
        ...(() => {
          const e = zendesk.mapTicketToRawEvent({
            id: 901,
            subject: "Cannot log in",
            created_at: openedAt.toISOString(),
            updated_at: openedAt.toISOString(),
            status: "open",
            priority: "normal",
            requester_id: 1,
            via: { channel: "web" },
            tags: [],
          } as never);
          return { providerEventId: e.providerEventId, sourceHash: e.sourceHash, payload: e.payload as never };
        })(),
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function addTracker(status: "connected" | "disconnected" = "connected") {
    const tracker = await prisma.integration.create({
      data: { organizationId, provider: "jira", status, credentials: {}, cursor: done, lastSuccessfulSyncAt: new Date() },
    });
    const e = jira.mapRemoteLinkToRawEvent("KAN-9", {
      id: 1,
      self: "s",
      object: { url: "https://pv.zendesk.com/agent/tickets/901", title: "t" },
    } as never);
    await prisma.rawEvent.create({
      data: { integrationId: tracker.id, providerEventId: e.providerEventId, sourceHash: e.sourceHash, payload: e.payload as never },
    });
    return tracker;
  }

  it("a ticket-source-only organization has support-side findings and no engineering figure", async () => {
    await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);

    const result = await findings.getFindingsData(prisma, organizationId);
    expect(result).toMatchObject({ trackerConnected: false, totalEscalated: 0, exceededTarget: 0, avgEngineeringMinutes: null, topAccounts: [] });

    const data = await dashboard.getDashboardData(prisma, organizationId);
    expect(data.engineeringMeasured).toBe(false);
    // The support side is fully measured: the case and both commitments exist.
    expect(data.atRisk.length + data.healthByKind.reduce((n, k) => n + k.onTrack + k.atRisk + k.breached, 0)).toBeGreaterThan(0);
  });

  it("no leg of a ticket-source-only case is engineering", async () => {
    await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);
    const core = await import("@sla/core");
    const domain = await import("@sla/commitments");

    const caseRow = await prisma.case.findFirstOrThrow({ where: { organizationId, externalId: "901" } });
    expect(await prisma.caseLink.count({ where: { caseId: caseRow.id } })).toBe(0);
    const events = (await prisma.normalizedEvent.findMany({ where: { caseId: caseRow.id } })).map((row) =>
      domain.toNormalizedEventDomain(row),
    );
    const { spans } = core.deriveLegSpans(events, { caseOpenedAt: openedAt.toISOString() });
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((span) => span.leg === "engineering")).toBe(false);
  });

  it("connecting a tracker makes engineering time measured, and an engineering leg needs a certain link", async () => {
    await addTracker();
    await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);

    const link = await prisma.caseLink.findFirstOrThrow({ where: { case: { organizationId }, system: "jira" } });
    expect(link.confidence).toBe("certain");

    const data = await dashboard.getDashboardData(prisma, organizationId);
    expect(data.engineeringMeasured).toBe(true);
    const result = await findings.getFindingsData(prisma, organizationId);
    expect(result.trackerConnected).toBe(true);
  });

  it("a tracker that was disconnected keeps the engineering time it recorded as measured", async () => {
    const tracker = await addTracker();
    await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);
    await prisma.integration.update({ where: { id: tracker.id }, data: { status: "disconnected", disconnectedAt: new Date() } });

    const data = await dashboard.getDashboardData(prisma, organizationId);
    expect(data.engineeringMeasured).toBe(true);
    expect((await findings.getFindingsData(prisma, organizationId)).trackerConnected).toBe(true);
  });

  it("a disconnected tracker that never recorded anything leaves engineering unmeasured", async () => {
    await prisma.integration.create({
      data: { organizationId, provider: "jira", status: "disconnected", disconnectedAt: new Date(), credentials: {} },
    });
    await sourceSync.projectAndEvaluateSourceSyncs(prisma, organizationId);

    expect((await dashboard.getDashboardData(prisma, organizationId)).engineeringMeasured).toBe(false);
    expect((await findings.getFindingsData(prisma, organizationId)).trackerConnected).toBe(false);
  });
});
