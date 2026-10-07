/**
 * The dashboard consumes canonical Elapsed data only. These tests pin that.
 *
 * Part 1 (real Postgres): one canonical scenario — the same Cases, Normalized
 * Events, CaseLinks and SLA policy — is written under every ticket source ×
 * tracker pair (Zendesk/Intercom × Jira/Linear), run through the real
 * commitment and evaluation pipelines, then read through `getDashboardData`.
 * The dashboard must produce the identical domain-level result for every pair.
 * The rows are written directly in the canonical contract (no adapter), so the
 * test is exactly "a provider that conforms to the contract needs no dashboard
 * change": nothing here, and nothing in the dashboard, names a provider except
 * as an opaque `system` value.
 *
 * Part 2 (static): the dashboard's data modules name no provider. Provider
 * knowledge stays in the registry (`providers.ts`) and the adapters.
 *
 * Part 1 needs a migrated database at TEST_DATABASE_URL whose name contains
 * "test"; skipped when unset.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IntegrationProvider, PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type TicketSource = "zendesk" | "intercom";
type Tracker = "jira" | "linear";

const PAIRS: { source: TicketSource; tracker: Tracker }[] = [
  { source: "zendesk", tracker: "jira" },
  { source: "zendesk", tracker: "linear" },
  { source: "intercom", tracker: "jira" },
  { source: "intercom", tracker: "linear" },
];

const NOW = new Date("2026-10-07T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe.skipIf(!TEST_DATABASE_URL)("dashboard is provider-agnostic (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");
  let getDashboardData: typeof import("../src/lib/dashboard-data").getDashboardData;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    commitments = await import("@sla/commitments");
    ({ getDashboardData } = await import("../src/lib/dashboard-data"));
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  let eventSeq = 0;
  async function addEvent(
    integrationId: string,
    caseId: string,
    system: IntegrationProvider,
    sourceRole: "ticket_source" | "work_tracker",
    type: string,
    at: Date,
    actor: "customer" | "agent" | "system",
    toState: string | null,
  ) {
    eventSeq += 1;
    const rawEvent = await prisma.rawEvent.create({
      data: { integrationId, providerEventId: `evt-${eventSeq}`, sourceHash: `h-${eventSeq}`, payload: {} },
    });
    await prisma.normalizedEvent.create({
      data: { caseId, sourceRawEventId: rawEvent.id, type, occurredAt: at, actor, system, sourceRole, fromState: null, toState },
    });
  }

  /**
   * Three cases, defined only in canonical terms:
   *  - A: closed after 1.5h, answered in 20min             -> both commitments met
   *  - B: closed after 3h, answered in 2h, linked to a tracker issue -> both breached, escalated
   *  - C: still open, opened 10min ago                      -> both on track
   */
  async function seedCanonicalScenario(source: TicketSource, tracker: Tracker) {
    const organizationId = (await prisma.organization.create({ data: { name: `Agnostic ${source}+${tracker}` } })).id;
    const calendar = await prisma.businessCalendar.create({
      data: {
        organizationId,
        name: "24/7",
        versions: { create: { version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true } },
      },
      include: { versions: true },
    });
    const policy = await prisma.sLAPolicy.create({ data: { organizationId, name: "Default", source: "native" } });
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
        effectiveFrom: minutesAgo(30 * 24 * 60),
      },
    });
    const sourceIntegration = await prisma.integration.create({
      data: { organizationId, provider: source, status: "connected", credentials: {}, lastSuccessfulSyncAt: NOW },
    });
    const trackerIntegration = await prisma.integration.create({
      data: { organizationId, provider: tracker, status: "connected", credentials: {}, lastSuccessfulSyncAt: NOW },
    });

    const makeCase = async (externalId: string, openedAt: Date, closedAt: Date | null) => {
      const row = await prisma.case.create({
        data: {
          organizationId,
          system: source,
          sourceIntegrationId: sourceIntegration.id,
          externalId,
          subject: `Case ${externalId}`,
          openedAt,
          closedAt,
        },
      });
      await addEvent(sourceIntegration.id, row.id, source, "ticket_source", "case_created", openedAt, "customer", "open");
      return row;
    };

    const a = await makeCase("A", minutesAgo(180), minutesAgo(90));
    await addEvent(sourceIntegration.id, a.id, source, "ticket_source", "agent_replied", minutesAgo(160), "agent", null);
    await addEvent(sourceIntegration.id, a.id, source, "ticket_source", "case_closed", minutesAgo(90), "agent", "resolved");

    const b = await makeCase("B", minutesAgo(240), minutesAgo(60));
    await addEvent(sourceIntegration.id, b.id, source, "ticket_source", "agent_replied", minutesAgo(120), "agent", null);
    await addEvent(trackerIntegration.id, b.id, tracker, "work_tracker", "issue_linked", minutesAgo(110), "agent", null);
    await addEvent(trackerIntegration.id, b.id, tracker, "work_tracker", "state_changed", minutesAgo(70), "agent", "resolved");
    await addEvent(sourceIntegration.id, b.id, source, "ticket_source", "case_closed", minutesAgo(60), "agent", "resolved");
    await prisma.caseLink.create({
      data: { caseId: b.id, system: tracker, externalId: "ISSUE-1", method: "remote_link", confidence: "certain" },
    });

    await makeCase("C", minutesAgo(10), null);

    const asOf = NOW.toISOString();
    await commitments.runCommitmentPipeline(prisma, organizationId);
    await commitments.runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" });
    return organizationId;
  }

  async function dashboardSummary(organizationId: string) {
    const d = await getDashboardData(prisma, organizationId, NOW);
    return {
      compliance: d.compliance,
      breachedThisPeriod: d.breachedThisPeriod.total,
      healthByKind: d.healthByKind.map((h) => [h.kind, h.onTrack, h.atRisk, h.breached]),
      linkCoverage: { cases: d.linkCoverage.cases, linkedCases: d.linkCoverage.linkedCases },
      totalEscalated: d.totalEscalated,
      unmatched: d.unmatchedCases.length,
      atRiskCases: d.atRisk.map((r) => r.externalId).sort(),
    };
  }

  const EXPECTED = {
    // A's two commitments met, B's two breached: 2 of 4 closed commitments.
    compliance: { current: 50, previous: null },
    breachedThisPeriod: 2,
    healthByKind: [
      ["first_response", 1, 0, 0],
      ["next_reply", 0, 0, 0],
      ["resolution", 1, 0, 0],
    ],
    linkCoverage: { cases: 3, linkedCases: 1 },
    totalEscalated: { count: 1, linkedCertain: 1, unlinkedOrOther: 0 },
    unmatched: 0,
    atRiskCases: ["C", "C"],
  };

  describe.each(PAIRS)("$source + $tracker", ({ source, tracker }) => {
    it("computes the same canonical metrics as every other provider pair", async () => {
      const organizationId = await seedCanonicalScenario(source, tracker);
      expect(await dashboardSummary(organizationId)).toEqual(EXPECTED);
    });
  });

  it("reports closed cases of a source that created no policy as unmonitored, like any other source", async () => {
    // Intercom imports no policies. With none configured, its closed cases
    // produce no commitments and therefore no SLA metrics: the dashboard has
    // to say so rather than present an empty-but-healthy page.
    const organizationId = (await prisma.organization.create({ data: { name: "No policy" } })).id;
    const integration = await prisma.integration.create({
      data: { organizationId, provider: "intercom", status: "connected", credentials: {}, lastSuccessfulSyncAt: NOW },
    });
    const row = await prisma.case.create({
      data: {
        organizationId,
        system: "intercom",
        sourceIntegrationId: integration.id,
        externalId: "I1",
        subject: "Closed Intercom conversation",
        openedAt: minutesAgo(180),
        closedAt: minutesAgo(90),
      },
    });
    await addEvent(integration.id, row.id, "intercom", "ticket_source", "case_created", minutesAgo(180), "customer", "open");
    await addEvent(integration.id, row.id, "intercom", "ticket_source", "case_closed", minutesAgo(90), "agent", "resolved");
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const d = await getDashboardData(prisma, organizationId, NOW);
    expect(d.compliance.current).toBeNull();
    expect(d.unmatchedCases.map((c) => c.externalId)).toEqual(["I1"]);
  });
});

describe("dashboard data modules name no provider", () => {
  const FILES = [
    "dashboard-data.ts",
    "analytics-data.ts",
    "at-risk-data.ts",
    "link-coverage-data.ts",
    "anomaly-data.ts",
  ];
  const PROVIDER_LITERAL = /["'`](zendesk|jira|intercom|linear|github)["'`]/i;

  it.each(FILES)("%s has no provider-name literal", (file) => {
    const source = readFileSync(fileURLToPath(new URL(`../src/lib/${file}`, import.meta.url)), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(PROVIDER_LITERAL);
  });
});
