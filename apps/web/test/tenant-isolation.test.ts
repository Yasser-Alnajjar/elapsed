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
import { NextRequest } from "next/server";
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
      identities: {
        create: { organizationId, provider: "zendesk", kind: "organization", externalId: `${label}-zd-org` },
      },
    },
  });

  const caseRow = await prisma.case.create({
    data: {
      organizationId,
      system: "zendesk",
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
            sourceRole: "ticket_source",
            toState: "new",
          },
          {
            sourceRawEventId: rawEvent.id,
            type: "state_changed",
            occurredAt: new Date(openedAt.getTime() + 60_000),
            actor: `${label} agent`,
            system: "zendesk",
            sourceRole: "ticket_source",
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

interface SeededExtras {
  invitationId: string;
  invitationEmail: string;
  memberId: string;
  resetToken: string;
  verifyToken: string;
}

/** Rows for the models `seedOrg` doesn't create; every text field carries the org label. */
async function seedExtras(
  prisma: PrismaClient,
  label: string,
  org: SeededOrg,
): Promise<SeededExtras> {
  const lower = label.toLowerCase();
  const { hashToken } = await import("@sla/db");
  const resetToken = `${lower}-reset-token`;
  const verifyToken = `${lower}-verify-token`;
  const invitationEmail = `invitee-${lower}@example.test`;

  await prisma.passwordResetToken.create({
    data: {
      userId: org.userId,
      tokenHash: hashToken(resetToken),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  await prisma.emailVerificationToken.create({
    data: {
      userId: org.userId,
      tokenHash: hashToken(verifyToken),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const invitation = await prisma.organizationInvitation.create({
    data: {
      organizationId: org.organizationId,
      email: invitationEmail,
      tokenHash: hashToken(`${lower}-invite-token`),
      invitedByUserId: org.userId,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  // A second, non-owner member so demote/remove targets exist.
  const member = await prisma.user.create({
    data: {
      organizationId: org.organizationId,
      email: `member-${lower}@example.test`,
      passwordHash: "unused",
      role: "member",
    },
  });
  await prisma.slaImportSummary.create({
    data: {
      organizationId: org.organizationId,
      unsupportedConditions: label === A ? 11 : 22,
    },
  });
  await prisma.slackIntegration.create({
    data: {
      organizationId: org.organizationId,
      accessToken: `${label}-slack-token`,
      teamId: `${label}-team`,
      teamName: `${label} Slack Team`,
      botUserId: `${label}-bot`,
      channelId: `${label}-channel-id`,
      channelName: `${label}-channel`,
    },
  });
  await prisma.integrationConfig.create({
    data: {
      organizationId: org.organizationId,
      provider: "zendesk",
      clientId: `${label}-client-id`,
      clientSecret: "unused",
    },
  });
  // Worker scheduling state (multi-worker leases): never served to a tenant, but keyed per organization.
  await prisma.organizationWorkState.create({ data: { organizationId: org.organizationId } });

  const commitments = await prisma.commitment.findMany({
    where: { caseId: org.caseId },
  });
  const open = commitments.find((c) => c.closedAt === null)!;
  await prisma.commitmentPolicyChange.create({
    data: {
      commitmentId: open.id,
      previousPolicyVersionId: open.policyVersionId,
      newPolicyVersionId: open.policyVersionId,
      previousTargetMinutes: 240,
      newTargetMinutes: 120,
      previousCalendarVersionId: open.calendarVersionId,
      newCalendarVersionId: open.calendarVersionId,
      changedAt: new Date(),
      reason: `${label} changed the target`,
    },
  });
  await prisma.notification.create({
    data: { commitmentId: open.id, threshold: 80, channel: `${label}-channel` },
  });
  await prisma.notificationFailure.create({
    data: { commitmentId: open.id, threshold: 95, error: `${label} smtp refused` },
  });
  await prisma.legSpan.create({
    data: {
      caseId: org.caseId,
      leg: "support",
      confidence: "certain",
      startedAt: new Date(),
      note: `${label} leg`,
    },
  });

  return {
    invitationId: invitation.id,
    invitationEmail,
    memberId: member.id,
    resetToken,
    verifyToken,
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
  let extraA: SeededExtras;
  let extraB: SeededExtras;
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
    getPolicyImportReview: typeof import("../src/lib/policy-import-review-data").getPolicyImportReview;
    assertSessionStillValid: typeof import("../src/lib/session-validity").assertSessionStillValid;
  };
  let routes: {
    reportCsv: typeof import("../src/app/api/reports/commitments/route");
    customerCalendars: typeof import("../src/app/api/settings/customer-calendars/route");
    policyOverride: typeof import("../src/app/api/settings/sla-policies/override/route");
    engineeringTarget: typeof import("../src/app/api/settings/engineering-target/route");
    email: typeof import("../src/app/api/settings/email/route");
    jiraDisconnect: typeof import("../src/app/api/integrations/jira/disconnect/route");
    zendeskWebhook: typeof import("../src/app/api/webhooks/zendesk/[integrationId]/route");
    emailTestConnection: typeof import("../src/app/api/settings/email/test-connection/route");
    emailTestSend: typeof import("../src/app/api/settings/email/test-send/route");
    members: typeof import("../src/app/api/settings/members/route");
    member: typeof import("../src/app/api/settings/members/[id]/route");
    invitations: typeof import("../src/app/api/settings/invitations/route");
    invitation: typeof import("../src/app/api/settings/invitations/[id]/route");
    slackChannel: typeof import("../src/app/api/integrations/slack/channel/route");
    slackDisconnect: typeof import("../src/app/api/integrations/slack/disconnect/route");
    zendeskConfig: typeof import("../src/app/api/integrations/zendesk/config/route");
    passwordResetConfirm: typeof import("../src/app/api/password-reset/confirm/route");
    emailVerificationConfirm: typeof import("../src/app/api/email-verification/confirm/route");
  };

  beforeAll(async () => {
    assertDisposableDatabase(TEST_DATABASE_URL!);
    // @sla/db builds its connection from DATABASE_URL at import time, so the
    // override must land before anything imports it; hence dynamic imports.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.SMTP_ENCRYPTION_KEY ??= "tenant-isolation-test-smtp-key";
    process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY ??=
      "tenant-isolation-test-integration-key";
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ??=
      "tenant-isolation-test-token-key";

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
      ...(await import("../src/lib/policy-import-review-data")),
      ...(await import("../src/lib/session-validity")),
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
      emailTestConnection:
        await import("../src/app/api/settings/email/test-connection/route"),
      emailTestSend: await import("../src/app/api/settings/email/test-send/route"),
      members: await import("../src/app/api/settings/members/route"),
      member: await import("../src/app/api/settings/members/[id]/route"),
      invitations: await import("../src/app/api/settings/invitations/route"),
      invitation: await import("../src/app/api/settings/invitations/[id]/route"),
      slackChannel: await import("../src/app/api/integrations/slack/channel/route"),
      slackDisconnect:
        await import("../src/app/api/integrations/slack/disconnect/route"),
      zendeskConfig: await import("../src/app/api/integrations/zendesk/config/route"),
      passwordResetConfirm:
        await import("../src/app/api/password-reset/confirm/route"),
      emailVerificationConfirm:
        await import("../src/app/api/email-verification/confirm/route"),
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
    extraA = await seedExtras(prisma, A, orgA);
    extraB = await seedExtras(prisma, B, orgB);
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

    it("compliance report helper, CSV export route and JSON export route", async () => {
      expectOnlyOrgA(
        await lib.getComplianceReportRows(prisma, orgA.organizationId, now),
      );

      const csvResponse = await routes.reportCsv.GET(
        new NextRequest("http://localhost/api/reports/commitments"),
      );
      expect(csvResponse.status).toBe(200);
      expectOnlyOrgA(await csvResponse.text());

      const jsonResponse = await routes.reportCsv.GET(
        new NextRequest(
          "http://localhost/api/reports/commitments?format=json",
        ),
      );
      expect(jsonResponse.status).toBe(200);
      const json = await jsonResponse.text();
      expectOnlyOrgA(json);
      expect(() => JSON.parse(json)).not.toThrow();
      expect(Array.isArray(JSON.parse(json))).toBe(true);
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

  describe("customer identities are scoped to their organization", () => {
    const ref = (organizationId: string, externalId: string) => ({
      organizationId,
      provider: "zendesk" as const,
      kind: "organization",
      externalId,
      legacy: { zendeskOrgId: externalId },
    });

    it("resolves an identity only inside its own organization", async () => {
      const { findCustomerByIdentity } = await import("@sla/db");
      const own = await findCustomerByIdentity(prisma, ref(orgA.organizationId, `${A}-zd-org`));
      expect(own?.id).toBe(orgA.customerId);
      // B's external id, asked for as org A, is not visible.
      expect(await findCustomerByIdentity(prisma, ref(orgA.organizationId, `${B}-zd-org`))).toBeNull();
    });

    it("the same provider id in two organizations names two customers", async () => {
      const { upsertCustomerByIdentity } = await import("@sla/db");
      const inA = await upsertCustomerByIdentity(prisma, ref(orgA.organizationId, "shared-id"), "Shared A");
      const inB = await upsertCustomerByIdentity(prisma, ref(orgB.organizationId, "shared-id"), "Shared B");
      expect(inA.id).not.toBe(inB.id);
      expect(inA.organizationId).toBe(orgA.organizationId);
      expect(inB.organizationId).toBe(orgB.organizationId);
      expect(await prisma.customerIdentity.count({ where: { externalId: "shared-id" } })).toBe(2);
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

  describe("models the original suite did not name (H-10)", () => {
    const url = "http://localhost:3000/api";
    const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

    it("reads: members, pending invitations, import review, integrations (Slack, config) and case detail (events, links, notifications, policy changes) show only this org", async () => {
      expectOnlyOrgA(await (await routes.members.GET()).json());
      expectOnlyOrgA(await (await routes.invitations.GET()).json());
      const review = await lib.getPolicyImportReview(prisma, orgA.organizationId);
      expect(review.warnings.unsupportedConditions).toBe(11);
      const integrations = await lib.getIntegrationsData(prisma, orgA.organizationId);
      expectOnlyOrgA(integrations);
      const detail = await lib.getCaseDetailData(prisma, orgA.organizationId, orgA.caseId, now);
      const text = JSON.stringify(detail).toLowerCase();
      expect(text).toContain("alpha changed the target");
      expect(text).not.toContain("bravo");
    });

    it("work-state leases are per organization: claiming, renewing and completing one organization's row never touches another's", async () => {
      const dbModule = await import("@sla/db");
      // Only A is due, so only A is leased; B's row stays untouched and unleased.
      const later = new Date(Date.now() + 3_600_000);
      await prisma.organizationWorkState.update({
        where: { organizationId: orgB.organizationId },
        data: { activeNextDueAt: later, reconciliationNextDueAt: later },
      });
      const claims = await dbModule.claimDueOrganizations(prisma, { owner: "tenant-test-worker", limit: 10 });
      expect(claims.map((claim) => claim.organizationId)).toEqual([orgA.organizationId]);
      const mine = claims[0]!;

      // A claim for A, re-pointed at B, opens nothing on B's row.
      const forged = { ...mine, organizationId: orgB.organizationId };
      expect(await dbModule.renewLease(prisma, forged)).toBe(false);
      expect(await dbModule.releaseLease(prisma, forged)).toBe(false);
      expect(
        await dbModule.completeWork(prisma, forged, { failed: false, activeIntervalMs: 10_000, reconciliationIntervalMs: 1_800_000 }),
      ).toBe(false);

      // Completing A leaves B's schedule and lease exactly as they were.
      const beforeB = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: orgB.organizationId } });
      expect(
        await dbModule.completeWork(prisma, mine, { failed: true, error: "alpha only", activeIntervalMs: 10_000, reconciliationIntervalMs: 1_800_000 }),
      ).toBe(true);
      const afterB = await prisma.organizationWorkState.findUniqueOrThrow({ where: { organizationId: orgB.organizationId } });
      expect(afterB.lastError).toBeNull();
      expect(afterB.consecutiveFailures).toBe(0);
      expect(afterB.activeNextDueAt).toEqual(beforeB.activeNextDueAt);
    });

    it("dashboard failed-alert list carries this org's NotificationFailure only", async () => {
      const data = await lib.getDashboardData(prisma, orgA.organizationId, now);
      const text = JSON.stringify(data).toLowerCase();
      expect(text).toContain("alpha smtp refused");
      expect(text).not.toContain("bravo smtp refused");
    });

    it("revoking another org's invitation is a no-op", async () => {
      const response = await routes.invitation.DELETE(
        new Request(`${url}/settings/invitations/${extraB.invitationId}`, { method: "DELETE" }),
        idParams(extraB.invitationId),
      );
      expect(response.status).toBe(200);
      const b = await prisma.organizationInvitation.findUniqueOrThrow({ where: { id: extraB.invitationId } });
      expect(b.status).toBe("pending");
      // Control: own invitation is revoked.
      await routes.invitation.DELETE(
        new Request(`${url}/settings/invitations/${extraA.invitationId}`, { method: "DELETE" }),
        idParams(extraA.invitationId),
      );
      const a = await prisma.organizationInvitation.findUniqueOrThrow({ where: { id: extraA.invitationId } });
      expect(a.status).toBe("revoked");
    });

    it("changing the role of, or removing, another org's member is rejected and changes nothing", async () => {
      const patch = await routes.member.PATCH(
        jsonRequest(`${url}/settings/members/${extraB.memberId}`, { role: "owner" }),
        idParams(extraB.memberId),
      );
      expect(patch.status).toBe(404);
      const del = await routes.member.DELETE(
        new Request(`${url}/settings/members/${extraB.memberId}`, { method: "DELETE" }),
        idParams(extraB.memberId),
      );
      expect(del.status).toBe(404);
      const b = await prisma.user.findUniqueOrThrow({ where: { id: extraB.memberId } });
      expect(b.role).toBe("member");
      expect(b.sessionVersion).toBe(0);
    });

    it("Slack channel and disconnect only touch the session's organization", async () => {
      const set = await routes.slackChannel.POST(
        jsonRequest(`${url}/integrations/slack/channel`, { channelId: "C-NEW", channelName: "new-channel" }),
      );
      expect(set.status).toBe(200);
      const off = await routes.slackDisconnect.POST();
      expect(off.status).toBe(200);
      expect(await prisma.slackIntegration.count({ where: { organizationId: orgA.organizationId } })).toBe(0);
      const b = await prisma.slackIntegration.findUniqueOrThrow({ where: { organizationId: orgB.organizationId } });
      expect(b.channelId).toBe("BRAVO-channel-id");
    });

    it("saving an OAuth client config only changes the session's organization", async () => {
      const response = await routes.zendeskConfig.POST(
        jsonRequest(`${url}/integrations/zendesk/config`, { clientId: "alpha-new-id", clientSecret: "alpha-new-secret" }),
      );
      expect(response.status).toBe(200);
      const [a, b] = await Promise.all([
        prisma.integrationConfig.findUniqueOrThrow({
          where: { organizationId_provider: { organizationId: orgA.organizationId, provider: "zendesk" } },
        }),
        prisma.integrationConfig.findUniqueOrThrow({
          where: { organizationId_provider: { organizationId: orgB.organizationId, provider: "zendesk" } },
        }),
      ]);
      expect(a.clientId).toBe("alpha-new-id");
      expect(b.clientId).toBe("BRAVO-client-id");
      expect(b.clientSecret).toBe("unused");
    });

    it("an own policy override creates no policy-change, notification or failure row for another org", async () => {
      const before = {
        changes: await prisma.commitmentPolicyChange.count({ where: { commitment: { case: { organizationId: orgB.organizationId } } } }),
        notes: await prisma.notification.count({ where: { commitment: { case: { organizationId: orgB.organizationId } } } }),
        fails: await prisma.notificationFailure.count({ where: { commitment: { case: { organizationId: orgB.organizationId } } } }),
      };
      const response = await routes.policyOverride.POST(
        jsonRequest(`${url}/settings/sla-policies/override`, {
          policyId: orgA.policyId,
          targets: [{ kind: "resolution", minutes: 5 }],
        }),
      );
      expect(response.status).toBe(200);
      expect({
        changes: await prisma.commitmentPolicyChange.count({ where: { commitment: { case: { organizationId: orgB.organizationId } } } }),
        notes: await prisma.notification.count({ where: { commitment: { case: { organizationId: orgB.organizationId } } } }),
        fails: await prisma.notificationFailure.count({ where: { commitment: { case: { organizationId: orgB.organizationId } } } }),
      }).toEqual(before);
    });

    it("consuming one user's reset or verification token affects that user only", async () => {
      const reset = await routes.passwordResetConfirm.POST(
        jsonRequest(`${url}/password-reset/confirm`, { token: extraA.resetToken, password: "a-new-password-1" }),
      );
      expect(reset.status).toBe(200);
      const verify = await routes.emailVerificationConfirm.POST(
        jsonRequest(`${url}/email-verification/confirm`, { token: extraA.verifyToken }),
      );
      expect(verify.status).toBe(200);
      const b = await prisma.user.findUniqueOrThrow({ where: { id: orgB.userId } });
      expect(b.passwordHash).toBe("unused");
      expect(b.sessionVersion).toBe(0);
      expect(b.emailVerifiedAt).toBeNull();
      expect(await prisma.passwordResetToken.count({ where: { userId: orgB.userId, usedAt: null } })).toBe(1);
      expect(await prisma.emailVerificationToken.count({ where: { userId: orgB.userId, usedAt: null } })).toBe(1);
    });

    it("a token from one org's user can't be replayed against another (each token is single-use)", async () => {
      const first = await routes.passwordResetConfirm.POST(
        jsonRequest(`${url}/password-reset/confirm`, { token: extraB.resetToken, password: "another-password-1" }),
      );
      expect(first.status).toBe(200);
      const replay = await routes.passwordResetConfirm.POST(
        jsonRequest(`${url}/password-reset/confirm`, { token: extraB.resetToken, password: "another-password-2" }),
      );
      expect(replay.status).toBe(410);
    });

    it("demoting a member signs their existing sessions out (role is baked into the JWT)", async () => {
      // Promote the second member to owner so demoting them is allowed.
      const target = extraA.memberId;
      const token = { userId: target, sessionVersion: 0 };
      await expect(lib.assertSessionStillValid(prisma, token)).resolves.toBeUndefined();

      const promote = await routes.member.PATCH(
        jsonRequest(`${url}/settings/members/${target}`, { role: "owner" }),
        idParams(target),
      );
      expect(promote.status).toBe(200);
      await expect(lib.assertSessionStillValid(prisma, token)).rejects.toThrow(/no longer valid/);

      const fresh = { userId: target, sessionVersion: 1 };
      const demote = await routes.member.PATCH(
        jsonRequest(`${url}/settings/members/${target}`, { role: "member" }),
        idParams(target),
      );
      expect(demote.status).toBe(200);
      await expect(lib.assertSessionStillValid(prisma, fresh)).rejects.toThrow(/no longer valid/);
    });

    it("removing a member invalidates their session", async () => {
      const token = { userId: extraA.memberId, sessionVersion: 0 };
      const del = await routes.member.DELETE(
        new Request(`${url}/settings/members/${extraA.memberId}`, { method: "DELETE" }),
        idParams(extraA.memberId),
      );
      expect(del.status).toBe(200);
      await expect(lib.assertSessionStillValid(prisma, token)).rejects.toThrow(/no longer valid/);
    });

    it("a plain member can't use owner-only routes", async () => {
      auth.session = {
        ...sessionFor(orgA, A),
        user: { ...sessionFor(orgA, A).user, id: extraA.memberId, role: "member" },
      };
      const role = await routes.member.PATCH(
        jsonRequest(`${url}/settings/members/${orgA.userId}`, { role: "member" }),
        idParams(orgA.userId),
      );
      expect(role.status).toBe(403);
      expect((await routes.slackDisconnect.POST()).status).toBe(403);
      expect((await routes.jiraDisconnect.POST()).status).toBe(403);
      expect(await prisma.slackIntegration.count({ where: { organizationId: orgA.organizationId } })).toBe(1);
    });
  });

  describe("SMTP settings can't move the saved password or reach internal hosts (H-10 F-D)", () => {
    const url = "http://localhost:3000/api/settings/email";
    const base = {
      host: "smtp.alpha.test",
      port: 587,
      security: "starttls",
      username: "alpha",
      fromEmail: "alerts@alpha.test",
    };
    const save = (extra: Record<string, unknown>) =>
      routes.email.POST(jsonRequest(url, { ...base, ...extra }));
    const post = (route: { POST: (r: Request) => Promise<Response> }, path: string, body: Record<string, unknown>) =>
      route.POST(jsonRequest(`${url}/${path}`, body));

    beforeEach(async () => {
      expect((await save({ password: "alpha-saved-password" })).status).toBe(200);
    });

    it("saving a different host or username without a password is refused and changes nothing", async () => {
      for (const change of [{ host: "smtp.attacker.test" }, { username: "someone-else" }]) {
        const response = await save(change);
        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatch(/re-enter the smtp password/i);
      }
      const row = await prisma.organizationEmailSettings.findUniqueOrThrow({
        where: { organizationId: orgA.organizationId },
      });
      expect(row.host).toBe("smtp.alpha.test");
      expect(row.username).toBe("alpha");
    });

    it("saving with the password, or changing only port/security/from-address, is allowed", async () => {
      expect((await save({ host: "smtp.new.test", password: "fresh" })).status).toBe(200);
      expect((await save({ host: "SMTP.NEW.TEST.", password: undefined, port: 465, security: "ssl_tls" })).status).toBe(200);
      expect((await save({ host: "smtp.new.test", fromEmail: "other@alpha.test" })).status).toBe(200);
    });

    it("test actions never use the saved password for a different host or username", async () => {
      for (const route of [
        ["test-connection", routes.emailTestConnection],
        ["test-send", routes.emailTestSend],
      ] as const) {
        for (const change of [{ host: "smtp.attacker.test" }, { username: "someone-else" }]) {
          const response = await post(route[1], route[0], { ...base, ...change });
          expect(response.status).toBe(400);
          expect((await response.json()).error).toMatch(/re-enter the smtp password/i);
        }
      }
    });

    it("with the saved host and username a blank password falls back to the saved one (no re-entry demanded)", async () => {
      const response = await post(routes.emailTestConnection, "test-connection", base);
      // smtp.alpha.test doesn't resolve, so the attempt stops at the destination check,
      // which is only reached once the password fallback was accepted.
      expect((await response.json()).error).not.toMatch(/re-enter/i);
    });

    it.each(["127.0.0.1", "localhost", "169.254.169.254", "10.0.0.5", "[::1]", "192.168.1.10"])(
      "refuses %s for save, test-connection and test-send",
      async (host) => {
        const bare = host.replace(/^\[|\]$/g, "");
        const withPassword = { ...base, host: bare, password: "typed" };
        const saved = await save(withPassword);
        expect(saved.status).toBe(400);
        expect((await saved.json()).error).toMatch(/private|non-public/i);
        for (const [path, route] of [
          ["test-connection", routes.emailTestConnection],
          ["test-send", routes.emailTestSend],
        ] as const) {
          const response = await post(route, path, withPassword);
          expect(response.status).toBe(400);
          expect((await response.json()).error).toMatch(/private|non-public/i);
        }
        const row = await prisma.organizationEmailSettings.findUniqueOrThrow({
          where: { organizationId: orgA.organizationId },
        });
        expect(row.host).toBe("smtp.alpha.test");
      },
    );

    it("a plain member can't reach any of the three", async () => {
      auth.session = {
        ...sessionFor(orgA, A),
        user: { ...sessionFor(orgA, A).user, id: extraA.memberId, role: "member" },
      };
      expect((await save({ password: "x" })).status).toBe(403);
      expect((await post(routes.emailTestConnection, "test-connection", { ...base, password: "x" })).status).toBe(403);
      expect((await post(routes.emailTestSend, "test-send", { ...base, password: "x" })).status).toBe(403);
    });
  });
});
