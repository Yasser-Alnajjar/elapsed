/**
 * Tenant-isolation regression suite (roadmap step 37).
 *
 * Every other test in this repo uses an in-memory fake Prisma. This one
 * deliberately doesn't: isolation lives in real Prisma query semantics
 * (nested relation filters like `where: { case: { organizationId } }`,
 * composite unique lookups, `findFirst` guards before an update), and a fake
 * that re-implements those would mostly be testing itself.
 *
 * Two organizations are seeded with the same shape of data and distinct
 * marker strings. Acting as org A, every read must return A's marker and never
 * B's. Every write that names B's rows must fail without changing them.
 *
 * Needs a migrated Postgres at TEST_DATABASE_URL (see README "Tests and type
 * checks"). Skipped when unset. The database name must contain "test",
 * because every test truncates all tables.
 */
import type { Session } from "next-auth";
import type { PrismaClient } from "@sla/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => auth.session),
}));
// The real options module pulls in bcrypt and the credentials provider;
// routes only pass it through to the mocked getServerSession.
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// `server-only` throws unless bundled for React Server Components.
vi.mock("server-only", () => ({}));

function assertDisposableDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${name}". This suite truncates every table, so the name must contain "test".`,
    );
  }
}

const A = "ALPHA";
const B = "BRAVO";

interface SeededOrg {
  organizationId: string;
  userId: string;
  customerId: string;
  calendarId: string;
  policyId: string;
  caseId: string;
  zendeskIntegrationId: string;
  jiraIntegrationId: string;
  webhookSecret: string;
}

async function seedOrg(
  prisma: PrismaClient,
  label: string,
  now: Date,
): Promise<SeededOrg> {
  const openedAt = new Date(now.getTime() - 2 * 3_600_000);
  const lower = label.toLowerCase();
  const webhookSecret = `${lower}-webhook-secret-0123456789abcdef`;

  const organization = await prisma.organization.create({
    data: { name: `${label} Org` },
  });
  const organizationId = organization.id;

  const user = await prisma.user.create({
    data: {
      organizationId,
      email: `${lower}@example.test`,
      passwordHash: "unused",
      role: "owner",
    },
  });

  const zendesk = await prisma.integration.create({
    data: {
      organizationId,
      provider: "zendesk",
      credentials: {
        subdomain: `${lower}-helpdesk`,
        accessToken: `${label}-zendesk-token`,
        tokenType: "bearer",
        scope: "read",
      },
      webhookSecret,
    },
  });
  const jira = await prisma.integration.create({
    data: {
      organizationId,
      provider: "jira",
      credentials: {
        cloudId: `${label}-cloud`,
        siteUrl: `https://${lower}.atlassian.net`,
        accessToken: `${label}-jira-token`,
        tokenType: "bearer",
      },
    },
  });

  const rawEvent = await prisma.rawEvent.create({
    data: {
      integrationId: zendesk.id,
      providerEventId: `${label}-event-1`,
      sourceHash: `${label}-hash`,
      payload: {},
    },
  });

  const calendar = await prisma.businessCalendar.create({
    data: {
      organizationId,
      name: `${label} Calendar`,
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
      name: `${label} Policy`,
      externalId: `${label}-policy`,
      versions: {
        create: {
          version: 1,
          match: {},
          targets: [
            { kind: "first_response", minutes: 30 },
            { kind: "resolution", minutes: 240 },
          ],
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

  const customer = await prisma.customer.create({
    data: {
      organizationId,
      name: `${label} Customer`,
      zendeskOrgId: `${label}-zd-org`,
    },
  });

  const caseRow = await prisma.case.create({
    data: {
      organizationId,
      customerId: customer.id,
      externalId: `${label}-ticket-1`,
      subject: `${label} subject`,
      priority: "urgent",
      openedAt,
      caseLinks: {
        create: {
          system: "jira",
          externalId: `${label}-1`,
          method: "remote_link",
          confidence: "certain",
        },
      },
      normalizedEvents: {
        create: [
          {
            sourceRawEventId: rawEvent.id,
            type: "case_created",
            occurredAt: openedAt,
            actor: `${label} agent`,
            system: "zendesk",
            toState: "new",
          },
          {
            sourceRawEventId: rawEvent.id,
            type: "state_changed",
            occurredAt: new Date(openedAt.getTime() + 60_000),
            actor: `${label} agent`,
            system: "zendesk",
            fromState: "new",
            toState: "escalated",
          },
        ],
      },
    },
  });

  // One open commitment (live-evaluated by dashboard/report) and one closed,
  // breached commitment with a persisted evaluation (breach count, findings).
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
      status: "breached",
      inputs: {},
    },
  });

  return {
    organizationId,
    userId: user.id,
    customerId: customer.id,
    calendarId: calendar.id,
    policyId: policy.id,
    caseId: caseRow.id,
    zendeskIntegrationId: zendesk.id,
    jiraIntegrationId: jira.id,
    webhookSecret,
  };
}

function sessionFor(org: SeededOrg, label: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: {
      id: org.userId,
      organizationId: org.organizationId,
      email: `${label.toLowerCase()}@example.test`,
      emailVerifiedAt: new Date(),
      name: null,
      image: null,
      role: "owner",
      createdAt: new Date(),
    },
  };
}

/** Serializes a helper's result and checks it carries A's marker and none of B's, in any case (subdomains and emails are lowercased). */
function expectOnlyOrgA(result: unknown) {
  const text = (
    typeof result === "string" ? result : JSON.stringify(result)
  ).toLowerCase();
  expect(text).toContain(A.toLowerCase());
  expect(text).not.toContain(B.toLowerCase());
}

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!TEST_DATABASE_URL)("tenant isolation (real Postgres)", () => {
  let prisma: PrismaClient;
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  const now = new Date();

  let lib: {
    getDashboardData: typeof import("../src/lib/dashboard-data").getDashboardData;
    getCaseDetailData: typeof import("../src/lib/case-detail-data").getCaseDetailData;
    getCaseListData: typeof import("../src/lib/case-list-data").getCaseListData;
    getComplianceReportRows: typeof import("../src/lib/report-data").getComplianceReportRows;
    getFindingsData: typeof import("../src/lib/findings-data").getFindingsData;
    getSlaPolicies: typeof import("../src/lib/sla-policies-data").getSlaPolicies;
    getBusinessCalendars: typeof import("../src/lib/customer-calendars-data").getBusinessCalendars;
    getCustomerCalendarSummaries: typeof import("../src/lib/customer-calendars-data").getCustomerCalendarSummaries;
    getIntegrationsData: typeof import("../src/lib/integrations-data").getIntegrationsData;
  };
  let routes: {
    reportCsv: typeof import("../src/app/api/reports/commitments/route");
    customerCalendars: typeof import("../src/app/api/settings/customer-calendars/route");
    policyOverride: typeof import("../src/app/api/settings/sla-policies/override/route");
    engineeringTarget: typeof import("../src/app/api/settings/engineering-target/route");
    email: typeof import("../src/app/api/settings/email/route");
    jiraDisconnect: typeof import("../src/app/api/integrations/jira/disconnect/route");
    zendeskWebhook: typeof import("../src/app/api/webhooks/zendesk/[integrationId]/route");
  };

  beforeAll(async () => {
    assertDisposableDatabase(TEST_DATABASE_URL!);
    // @sla/db builds its connection from DATABASE_URL at import time, so the
    // override must land before anything imports it; hence dynamic imports.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.SMTP_ENCRYPTION_KEY ??= "tenant-isolation-test-smtp-key";
    process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY ??=
      "tenant-isolation-test-integration-key";

    prisma = (await import("@sla/db")).getPrismaClient();
    lib = {
      ...(await import("../src/lib/dashboard-data")),
      ...(await import("../src/lib/case-detail-data")),
      ...(await import("../src/lib/case-list-data")),
      ...(await import("../src/lib/report-data")),
      ...(await import("../src/lib/findings-data")),
      ...(await import("../src/lib/sla-policies-data")),
      ...(await import("../src/lib/customer-calendars-data")),
      ...(await import("../src/lib/integrations-data")),
    };
    routes = {
      reportCsv: await import("../src/app/api/reports/commitments/route"),
      customerCalendars:
        await import("../src/app/api/settings/customer-calendars/route"),
      policyOverride:
        await import("../src/app/api/settings/sla-policies/override/route"),
      engineeringTarget:
        await import("../src/app/api/settings/engineering-target/route"),
      email: await import("../src/app/api/settings/email/route"),
      jiraDisconnect:
        await import("../src/app/api/integrations/jira/disconnect/route"),
      zendeskWebhook:
        await import("../src/app/api/webhooks/zendesk/[integrationId]/route"),
    };
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    orgA = await seedOrg(prisma, A, now);
    orgB = await seedOrg(prisma, B, now);
    auth.session = sessionFor(orgA, A);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe("reads never include another organization's data", () => {
    it("dashboard", async () => {
      const data = await lib.getDashboardData(prisma, orgA.organizationId, now);
      expect(
        data.atRisk.length + data.breachedThisPeriod.total,
      ).toBeGreaterThan(0);
      expectOnlyOrgA(data);
    });

    it("case list", async () => {
      const data = await lib.getCaseListData(prisma, orgA.organizationId);
      expect(data.cases.map((c) => c.caseId)).toEqual([orgA.caseId]);
      expectOnlyOrgA(data);
    });

    it("case detail returns the org's own case and null for another org's case ID", async () => {
      expectOnlyOrgA(
        await lib.getCaseDetailData(
          prisma,
          orgA.organizationId,
          orgA.caseId,
          now,
        ),
      );
      expect(
        await lib.getCaseDetailData(
          prisma,
          orgA.organizationId,
          orgB.caseId,
          now,
        ),
      ).toBeNull();
    });

    it("compliance report helper and CSV export route", async () => {
      expectOnlyOrgA(
        await lib.getComplianceReportRows(prisma, orgA.organizationId, now),
      );

      const response = await routes.reportCsv.GET();
      expect(response.status).toBe(200);
      expectOnlyOrgA(await response.text());
    });

    it("findings", async () => {
      expectOnlyOrgA(
        await lib.getFindingsData(prisma, orgA.organizationId, now),
      );
    });

    it("SLA configuration: policies, calendars, customers", async () => {
      expectOnlyOrgA(await lib.getSlaPolicies(prisma, orgA.organizationId));
      expectOnlyOrgA(
        await lib.getBusinessCalendars(prisma, orgA.organizationId),
      );
      expectOnlyOrgA(
        await lib.getCustomerCalendarSummaries(prisma, orgA.organizationId),
      );
    });

    it("integrations page", async () => {
      expectOnlyOrgA(
        await lib.getIntegrationsData(prisma, orgA.organizationId),
      );
    });
  });

  describe("writes naming another organization's rows are rejected and change nothing", () => {
    const url = "http://localhost:3000/api";

    it("customer calendar: another org's customer, or another org's calendar", async () => {
      const foreignCustomer = await routes.customerCalendars.POST(
        jsonRequest(`${url}/settings/customer-calendars`, {
          customerId: orgB.customerId,
          calendarId: orgA.calendarId,
        }),
      );
      expect(foreignCustomer.status).toBe(404);

      const foreignCalendar = await routes.customerCalendars.POST(
        jsonRequest(`${url}/settings/customer-calendars`, {
          customerId: orgA.customerId,
          calendarId: orgB.calendarId,
        }),
      );
      expect(foreignCalendar.status).toBe(404);

      const customers = await prisma.customer.findMany({
        where: { id: { in: [orgA.customerId, orgB.customerId] } },
      });
      expect(customers.map((c) => c.calendarId)).toEqual([null, null]);

      // Control: the same call on the org's own rows succeeds.
      const own = await routes.customerCalendars.POST(
        jsonRequest(`${url}/settings/customer-calendars`, {
          customerId: orgA.customerId,
          calendarId: orgA.calendarId,
        }),
      );
      expect(own.status).toBe(200);
    });

    it("SLA policy override on another org's policy", async () => {
      const response = await routes.policyOverride.POST(
        jsonRequest(`${url}/settings/sla-policies/override`, {
          policyId: orgB.policyId,
          targets: [{ kind: "resolution", minutes: 1 }],
        }),
      );
      expect(response.status).toBe(404);
      expect(
        await prisma.sLAPolicyVersion.count({
          where: { policyId: orgB.policyId },
        }),
      ).toBe(1);

      const own = await routes.policyOverride.POST(
        jsonRequest(`${url}/settings/sla-policies/override`, {
          policyId: orgA.policyId,
          targets: [{ kind: "resolution", minutes: 1 }],
        }),
      );
      expect(own.status).toBe(200);
      expect(
        await prisma.sLAPolicyVersion.count({
          where: { policyId: orgA.policyId },
        }),
      ).toBe(2);
    });

    it("engineering-leg target only changes the session's own organization", async () => {
      const set = await routes.engineeringTarget.POST(
        jsonRequest(`${url}/settings/engineering-target`, {
          targetMinutes: 120,
        }),
      );
      expect(set.status).toBe(200);

      const orgs = await prisma.organization.findMany({
        select: { id: true, engineeringLegTargetMinutes: true },
      });
      const byId = new Map(
        orgs.map((o) => [o.id, o.engineeringLegTargetMinutes]),
      );
      expect(byId.get(orgA.organizationId)).toBe(120);
      expect(byId.get(orgB.organizationId)).toBeNull();
    });

    it("email settings are saved to, and read back from, the session's own organization only", async () => {
      const saved = await routes.email.POST(
        jsonRequest(`${url}/settings/email`, {
          host: "smtp.alpha.test",
          port: 587,
          security: "starttls",
          username: "alpha",
          password: "alpha-password",
          fromEmail: "alerts@alpha.test",
        }),
      );
      expect(saved.status).toBe(200);
      expect(
        await prisma.organizationEmailSettings.count({
          where: { organizationId: orgB.organizationId },
        }),
      ).toBe(0);

      auth.session = sessionFor(orgB, B);
      const readAsB = await routes.email.GET();
      expect(JSON.stringify(await readAsB.json())).not.toContain("alpha");
    });

    it("disconnecting an integration leaves the other organization's connection intact", async () => {
      const response = await routes.jiraDisconnect.POST();
      expect(response.status).toBe(200);

      const [jiraA, jiraB] = await Promise.all([
        prisma.integration.findUniqueOrThrow({
          where: { id: orgA.jiraIntegrationId },
        }),
        prisma.integration.findUniqueOrThrow({
          where: { id: orgB.jiraIntegrationId },
        }),
      ]);
      expect(jiraA.status).toBe("disconnected");
      expect(jiraB.status).toBe("connected");
      expect(jiraB.credentials).not.toBeNull();
    });

    it("a webhook for another org's integration rejects this org's secret", async () => {
      const response = await routes.zendeskWebhook.POST(
        jsonRequest(
          `${url}/webhooks/zendesk/${orgB.zendeskIntegrationId}`,
          { ticket_id: `${B}-ticket-1` },
          {
            authorization: `Bearer ${orgA.webhookSecret}`,
          },
        ),
        {
          params: Promise.resolve({ integrationId: orgB.zendeskIntegrationId }),
        },
      );
      expect(response.status).toBe(401);
      expect(
        await prisma.rawEvent.count({
          where: { integrationId: orgB.zendeskIntegrationId },
        }),
      ).toBe(1);
    });
  });
});
