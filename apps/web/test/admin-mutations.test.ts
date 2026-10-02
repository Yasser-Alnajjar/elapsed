/**
 * N4.2, N4.3 and N4.5 against a real Postgres: every admin action writes
 * exactly one audit row, in the same transaction as the change; a refused or
 * no-op request writes none; a tenant-detail view writes `view_tenant`; the
 * audit log outlives what it describes; and a tenant cannot see or write the
 * plan record.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"
 * (every test truncates all tables). Skipped when unset.
 */
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const OPERATOR = "ops@watchtower.test";

const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/request-context", () => ({
  getRequestContext: vi.fn(async () => {
    if (!auth.session) throw new Error("NEXT_REDIRECT:/sign-in");
    return { session: auth.session, userId: auth.session.user.id, organizationId: auth.session.user.organizationId, role: auth.session.user.role };
  }),
}));

function sessionFor(email: string, role: "owner" | "member", organizationId = "org-of-the-session"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email, emailVerifiedAt: new Date(), name: null, image: null, role, createdAt: new Date() },
  } as Session;
}

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe.skipIf(!TEST_DATABASE_URL)("admin mutations and audit log (real Postgres)", () => {
  let prisma: PrismaClient;
  let mutations: typeof import("../src/lib/admin-tenant-mutations");
  let audit: typeof import("../src/lib/admin-audit");
  let planRoute: typeof import("../src/app/api/admin/tenants/[organizationId]/plan/route");
  let integrationRoute: typeof import("../src/app/api/admin/integrations/[integrationId]/route");
  let orgRoute: typeof import("../src/app/api/settings/organization/route");

  let organizationId: string;
  let otherOrganizationId: string;
  let zendeskId: string;
  let jiraId: string;
  let githubId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.PLATFORM_ADMIN_EMAILS = OPERATOR;
    prisma = (await import("@sla/db")).getPrismaClient();
    mutations = await import("../src/lib/admin-tenant-mutations");
    audit = await import("../src/lib/admin-audit");
    planRoute = await import("../src/app/api/admin/tenants/[organizationId]/plan/route");
    integrationRoute = await import("../src/app/api/admin/integrations/[integrationId]/route");
    orgRoute = await import("../src/app/api/settings/organization/route");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );
    await prisma.workerSettings.create({
      data: { id: "singleton", activePollIntervalMs: 30_000, reconciliationIntervalMs: 1_800_000, freshnessGraceFactor: 3 },
    });
    organizationId = (await prisma.organization.create({ data: { name: "Acme" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other" } })).id;
    zendeskId = await sourceIntegration(prisma, organizationId, "zendesk");
    jiraId = await sourceIntegration(prisma, organizationId, "jira");
    githubId = (await prisma.integration.create({ data: { organizationId, provider: "github", status: "disconnected" } })).id;
    auth.session = sessionFor(OPERATOR, "member");
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const auditRows = () => prisma.adminAuditLog.findMany({ orderBy: { createdAt: "asc" } });

  describe("plan record (N4.3)", () => {
    const record = { plan: "team", planStatus: "active", trialEndsAt: null, billingReference: "INV-1042" } as const;

    it("a new organization starts on trial with no plan recorded", async () => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      expect(org).toMatchObject({ plan: null, planStatus: "trial", trialEndsAt: null, billingReference: null });
    });

    it("an edit changes the record and writes exactly one audit row with before and after", async () => {
      const result = await mutations.updatePlanRecord(prisma, { actorEmail: OPERATOR, organizationId, input: { ...record } });

      expect(result.changed).toBe(true);
      expect(await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).toMatchObject({
        plan: "team",
        planStatus: "active",
        billingReference: "INV-1042",
      });
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorEmail: OPERATOR, action: "update_plan", organizationId, integrationId: null });
      expect(rows[0]!.metadata).toEqual({
        before: { plan: null, planStatus: "trial", trialEndsAt: null, billingReference: null },
        after: record,
      });
    });

    it("saving the same values again changes nothing and writes no audit row", async () => {
      await mutations.updatePlanRecord(prisma, { actorEmail: OPERATOR, organizationId, input: { ...record } });
      const again = await mutations.updatePlanRecord(prisma, { actorEmail: OPERATOR, organizationId, input: { ...record } });

      expect(again.changed).toBe(false);
      expect(await auditRows()).toHaveLength(1);
    });

    it("an unknown organization is refused and writes nothing", async () => {
      await expect(
        mutations.updatePlanRecord(prisma, { actorEmail: OPERATOR, organizationId: "nope", input: { ...record } }),
      ).rejects.toBeInstanceOf(mutations.AdminNotFoundError);
      expect(await auditRows()).toHaveLength(0);
    });

    it("the change and its audit row are one transaction: if the audit write fails, the change does not happen", async () => {
      const failing = prisma.$extends({
        query: {
          adminAuditLog: {
            create: async () => {
              throw new Error("audit store unavailable");
            },
          },
        },
      }) as unknown as PrismaClient;

      await expect(
        mutations.updatePlanRecord(failing, { actorEmail: OPERATOR, organizationId, input: { ...record } }),
      ).rejects.toThrow("audit store unavailable");

      expect(await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).toMatchObject({
        plan: null,
        planStatus: "trial",
        billingReference: null,
      });
      expect(await auditRows()).toHaveLength(0);
    });

    it("never changes how the organization is monitored: no integration, case or worker row is touched", async () => {
      const before = JSON.stringify(await prisma.integration.findMany({ orderBy: { id: "asc" } }));
      const settingsBefore = JSON.stringify(await prisma.workerSettings.findMany());

      await mutations.updatePlanRecord(prisma, {
        actorEmail: OPERATOR,
        organizationId,
        input: { plan: "enterprise", planStatus: "cancelled", trialEndsAt: null, billingReference: null },
      });

      expect(JSON.stringify(await prisma.integration.findMany({ orderBy: { id: "asc" } }))).toBe(before);
      expect(JSON.stringify(await prisma.workerSettings.findMany())).toBe(settingsBefore);
    });

    describe("input validation", () => {
      const valid = { plan: "starter", planStatus: "trial", trialEndsAt: "2026-11-01", billingReference: " INV-7 " };

      it("accepts a plan from the live pricing page, trims the reference, and stores the trial end as an instant", () => {
        expect(mutations.parsePlanRecordInput(valid)).toEqual({
          plan: "starter",
          planStatus: "trial",
          trialEndsAt: "2026-11-01T00:00:00.000Z",
          billingReference: "INV-7",
        });
      });

      it("treats an empty plan, date and reference as 'not recorded'", () => {
        expect(mutations.parsePlanRecordInput({ plan: null, planStatus: "internal", trialEndsAt: "", billingReference: "  " })).toEqual({
          plan: null,
          planStatus: "internal",
          trialEndsAt: null,
          billingReference: null,
        });
      });

      it.each([
        ["an unknown plan", { ...valid, plan: "platinum" }],
        ["the retired pilot price as a plan", { ...valid, plan: "pilot-299" }],
        ["an unknown status", { ...valid, planStatus: "paused" }],
        ["a missing status", { ...valid, planStatus: undefined }],
        ["a bad date", { ...valid, trialEndsAt: "soon" }],
        ["a non-string date", { ...valid, trialEndsAt: 20261101 }],
        ["a non-string reference", { ...valid, billingReference: 42 }],
        ["an over-long reference", { ...valid, billingReference: "x".repeat(201) }],
        ["no body", null],
      ])("rejects %s", (_name, body) => {
        expect(() => mutations.parsePlanRecordInput(body)).toThrow(mutations.AdminValidationError);
      });

    });
  });

  describe("integration controls (N4.5)", () => {
    const control = (integrationId: string, action: "pause_polling" | "resume_polling" | "request_renormalize") =>
      mutations.controlIntegration(prisma, { actorEmail: OPERATOR, integrationId, action });
    const flags = (id: string) =>
      prisma.integration.findUniqueOrThrow({ where: { id }, select: { pollingPausedAt: true, renormalizeRequestedAt: true } });

    it("pause, resume and re-normalize each change one integration and write exactly one audit row", async () => {
      await control(zendeskId, "pause_polling");
      expect((await flags(zendeskId)).pollingPausedAt).not.toBeNull();
      await control(zendeskId, "resume_polling");
      expect((await flags(zendeskId)).pollingPausedAt).toBeNull();
      await control(zendeskId, "request_renormalize");
      expect((await flags(zendeskId)).renormalizeRequestedAt).not.toBeNull();

      const rows = await auditRows();
      expect(rows.map((r) => r.action)).toEqual(["pause_polling", "resume_polling", "request_renormalize"]);
      for (const row of rows) {
        expect(row).toMatchObject({ actorEmail: OPERATOR, organizationId, integrationId: zendeskId });
        expect(row.metadata).toEqual({ provider: "zendesk" });
      }
    });

    it("is scoped to the one integration: its sibling and other organizations are untouched", async () => {
      const otherId = await sourceIntegration(prisma, otherOrganizationId, "zendesk");

      await control(zendeskId, "pause_polling");
      await control(zendeskId, "request_renormalize");

      for (const id of [jiraId, githubId, otherId]) {
        expect(await flags(id)).toEqual({ pollingPausedAt: null, renormalizeRequestedAt: null });
      }
    });

    it("edits no tenant data: no case, event, commitment, policy or link row changes", async () => {
      const counts = async () => ({
        cases: await prisma.case.count(),
        events: await prisma.normalizedEvent.count(),
        rawEvents: await prisma.rawEvent.count(),
        commitments: await prisma.commitment.count(),
        policies: await prisma.sLAPolicy.count(),
        links: await prisma.caseLink.count(),
      });
      const before = await counts();

      await control(zendeskId, "pause_polling");
      await control(jiraId, "request_renormalize");

      expect(await counts()).toEqual(before);
    });

    it.each([
      ["pausing an already paused integration", "pause_polling", "Polling is already paused"],
      ["resuming one that is not paused", "resume_polling", "Polling is not paused"],
    ] as const)("%s is a conflict and writes no audit row", async (_name, action, message) => {
      if (action === "pause_polling") await control(zendeskId, "pause_polling");
      const rowsBefore = (await auditRows()).length;

      await expect(control(zendeskId, action)).rejects.toThrow(message);

      expect((await auditRows()).length).toBe(rowsBefore);
    });

    it("a second re-normalization request while one is waiting is a conflict", async () => {
      await control(zendeskId, "request_renormalize");
      await expect(control(zendeskId, "request_renormalize")).rejects.toBeInstanceOf(mutations.AdminConflictError);
      expect(await auditRows()).toHaveLength(1);
    });

    it("a disconnected integration has nothing to poll or normalize", async () => {
      for (const action of ["pause_polling", "request_renormalize"] as const) {
        await expect(control(githubId, action)).rejects.toBeInstanceOf(mutations.AdminConflictError);
      }
      expect(await auditRows()).toHaveLength(0);
    });

    it("an unknown integration is not found and writes nothing", async () => {
      await expect(control("nope", "pause_polling")).rejects.toBeInstanceOf(mutations.AdminNotFoundError);
      expect(await auditRows()).toHaveLength(0);
    });
  });

  describe("viewing a tenant (N4.2)", () => {
    it("opening the tenant detail writes exactly one view_tenant row, before returning the data", async () => {
      const { AdminActions } = await import("../src/actions/admin");

      const detail = await AdminActions.getTenantDetail(organizationId);

      expect(detail.tenant.name).toBe("Acme");
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorEmail: OPERATOR, action: "view_tenant", organizationId, integrationId: null });
    });

    it("an unknown tenant is not found and is not recorded as viewed", async () => {
      const { AdminActions } = await import("../src/actions/admin");

      await expect(AdminActions.getTenantDetail("nope")).rejects.toThrow("NEXT_NOT_FOUND");

      expect(await auditRows()).toHaveLength(0);
    });

    it("a non-operator is refused and nothing is recorded", async () => {
      auth.session = sessionFor("owner@acme.test", "owner", organizationId);
      const { AdminActions } = await import("../src/actions/admin");

      await expect(AdminActions.getTenantDetail(organizationId)).rejects.toThrow("NEXT_NOT_FOUND");

      expect(await auditRows()).toHaveLength(0);
    });

    it("reading the tenants list is not a per-tenant view", async () => {
      const { AdminActions } = await import("../src/actions/admin");

      await AdminActions.getTenants();

      expect(await auditRows()).toHaveLength(0);
    });
  });

  describe("the audit log", () => {
    it("lists newest first, pages by cursor, and resolves organization names", async () => {
      for (let i = 0; i < 5; i += 1) {
        await audit.recordAdminAudit(prisma, { actorEmail: OPERATOR, action: "view_tenant", organizationId });
        await new Promise((resolve) => setTimeout(resolve, 3));
      }

      const first = await audit.listAdminAuditLog(prisma, { limit: 2 });
      expect(first.rows).toHaveLength(2);
      expect(first.rows[0]!.organizationName).toBe("Acme");
      expect(first.nextCursor).not.toBeNull();

      const second = await audit.listAdminAuditLog(prisma, { limit: 2, before: first.nextCursor });
      const third = await audit.listAdminAuditLog(prisma, { limit: 2, before: second.nextCursor });
      expect(third.rows).toHaveLength(1);
      expect(third.nextCursor).toBeNull();

      const ids = [...first.rows, ...second.rows, ...third.rows].map((r) => r.id);
      expect(new Set(ids).size).toBe(5);
      const times = [...first.rows, ...second.rows, ...third.rows].map((r) => r.createdAt);
      expect(times).toEqual([...times].sort().reverse());
    });

    it("outlives the organization it describes", async () => {
      await mutations.updatePlanRecord(prisma, {
        actorEmail: OPERATOR,
        organizationId,
        input: { plan: "team", planStatus: "active", trialEndsAt: null, billingReference: null },
      });

      await prisma.organization.delete({ where: { id: organizationId } });

      const log = await audit.listAdminAuditLog(prisma);
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({ action: "update_plan", organizationId, organizationName: null });
    });
  });

  describe("API routes, end to end", () => {
    const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

    it("PATCH plan as the operator saves the record and audits it", async () => {
      const response = await planRoute.PATCH(
        json(`/api/admin/tenants/${organizationId}/plan`, "PATCH", { plan: "team", planStatus: "active", trialEndsAt: null, billingReference: "INV-9" }),
        params({ organizationId }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ changed: true, planRecord: { plan: "team", planStatus: "active", billingReference: "INV-9" } });
      expect((await auditRows()).map((r) => r.action)).toEqual(["update_plan"]);
    });

    it("PATCH plan: a tenant owner, even of this organization, gets 403 and nothing changes", async () => {
      auth.session = sessionFor("owner@acme.test", "owner", organizationId);

      const response = await planRoute.PATCH(
        json(`/api/admin/tenants/${organizationId}/plan`, "PATCH", { plan: "enterprise", planStatus: "active" }),
        params({ organizationId }),
      );

      expect(response.status).toBe(403);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).plan).toBeNull();
      expect(await auditRows()).toHaveLength(0);
    });

    it.each([
      ["a bad plan", { plan: "gold", planStatus: "active" }, 400],
      ["a bad status", { plan: "team", planStatus: "vip" }, 400],
    ])("PATCH plan with %s is 400 and writes nothing", async (_name, body, status) => {
      const response = await planRoute.PATCH(json(`/api/admin/tenants/${organizationId}/plan`, "PATCH", body), params({ organizationId }));

      expect(response.status).toBe(status);
      expect(await auditRows()).toHaveLength(0);
    });

    it("PATCH plan for an unknown organization is 404", async () => {
      const response = await planRoute.PATCH(
        json("/api/admin/tenants/nope/plan", "PATCH", { plan: "team", planStatus: "active" }),
        params({ organizationId: "nope" }),
      );
      expect(response.status).toBe(404);
    });

    it("POST integration control maps outcomes to 200, 409 and 404, and rejects an unknown action with 400", async () => {
      const call = (integrationId: string, body: unknown) =>
        integrationRoute.POST(json(`/api/admin/integrations/${integrationId}`, "POST", body), params({ integrationId }));

      expect((await call(zendeskId, { action: "pause_polling" })).status).toBe(200);
      expect((await call(zendeskId, { action: "pause_polling" })).status).toBe(409);
      expect((await call("nope", { action: "pause_polling" })).status).toBe(404);
      expect((await call(zendeskId, { action: "delete_everything" })).status).toBe(400);
      expect((await call(zendeskId, {})).status).toBe(400);
      expect((await auditRows()).map((r) => r.action)).toEqual(["pause_polling"]);
    });

    it("POST integration control: a tenant owner gets 403 and the flag stays unset", async () => {
      auth.session = sessionFor("owner@acme.test", "owner", organizationId);

      const response = await integrationRoute.POST(
        json(`/api/admin/integrations/${zendeskId}`, "POST", { action: "pause_polling" }),
        params({ integrationId: zendeskId }),
      );

      expect(response.status).toBe(403);
      expect((await prisma.integration.findUniqueOrThrow({ where: { id: zendeskId } })).pollingPausedAt).toBeNull();
      expect(await auditRows()).toHaveLength(0);
    });
  });

  describe("tenants cannot see or write the plan record", () => {
    it("the organization settings API returns neither the plan nor any admin-only field", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { plan: "team", planStatus: "active", billingReference: "INV-SECRET" } });
      auth.session = sessionFor("owner@acme.test", "owner", organizationId);

      const body = await (await orgRoute.GET()).json();

      expect(Object.keys(body).sort()).toEqual(["canEdit", "name", "timezone"]);
      expect(JSON.stringify(body)).not.toContain("INV-SECRET");
    });

    it("an owner cannot write the plan through the organization settings API", async () => {
      auth.session = sessionFor("owner@acme.test", "owner", organizationId);

      const response = await orgRoute.PATCH(
        json("/api/settings/organization", "PATCH", { name: "Acme 2", timezone: "UTC", plan: "enterprise", planStatus: "active", billingReference: "free" }),
      );

      expect(response.status).toBe(200);
      expect(await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).toMatchObject({
        name: "Acme 2",
        plan: null,
        planStatus: "trial",
        billingReference: null,
      });
    });
  });
});
