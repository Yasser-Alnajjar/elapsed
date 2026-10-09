/**
 * N10 (D33) admin side against a real Postgres: only a platform operator can
 * read or change integration availability; each change persists with exactly
 * one audit row (operator, provider, before/after, reason, never a secret); a
 * no-op writes nothing; concurrent edits never silently overwrite each other;
 * the N9.14-F1 rollout block refuses every widening of Custom REST while
 * narrowing stays possible; allowlists are per organization; disabling and
 * re-enabling never deletes or rewrites customer data.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"
 * (every test truncates all tables). Skipped when unset.
 */
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const OPERATOR = "ops@watchtower.test";

const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("server-only", () => ({}));

function sessionFor(email: string, role: "owner" | "member", organizationId = "org-of-the-session"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email, emailVerifiedAt: new Date(), name: null, image: null, role, createdAt: new Date() },
  } as Session;
}

const request = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

describe.skipIf(!TEST_DATABASE_URL)("integration availability administration (real Postgres)", () => {
  let prisma: PrismaClient;
  let listRoute: typeof import("../src/app/api/admin/integrations/route");
  let providerRoute: typeof import("../src/app/api/admin/integrations/providers/[provider]/route");
  let impactRoute: typeof import("../src/app/api/admin/integrations/providers/[provider]/impact/route");
  let allowlistRoute: typeof import("../src/app/api/admin/integrations/providers/[provider]/allowlist/route");
  let allowlistEntryRoute: typeof import("../src/app/api/admin/integrations/providers/[provider]/allowlist/[organizationId]/route");
  let legacyRoute: typeof import("../src/app/api/admin/tenants/[organizationId]/custom-provider/route");
  let resolve: typeof import("@sla/db").resolveIntegrationAvailability;

  let acme: string;
  let globex: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.PLATFORM_ADMIN_EMAILS = OPERATOR;
    const db = await import("@sla/db");
    prisma = db.getPrismaClient();
    resolve = db.resolveIntegrationAvailability;
    listRoute = await import("../src/app/api/admin/integrations/route");
    providerRoute = await import("../src/app/api/admin/integrations/providers/[provider]/route");
    impactRoute = await import("../src/app/api/admin/integrations/providers/[provider]/impact/route");
    allowlistRoute = await import("../src/app/api/admin/integrations/providers/[provider]/allowlist/route");
    allowlistEntryRoute = await import("../src/app/api/admin/integrations/providers/[provider]/allowlist/[organizationId]/route");
    legacyRoute = await import("../src/app/api/admin/tenants/[organizationId]/custom-provider/route");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    await prisma.workerSettings.create({
      data: { id: "singleton", activePollIntervalMs: 30_000, reconciliationIntervalMs: 1_800_000, freshnessGraceFactor: 3 },
    });
    // The migration's seed rows, which TRUNCATE removed.
    await prisma.integrationAvailability.createMany({
      data: [
        { provider: "zendesk", releaseStage: "stable" },
        { provider: "jira", releaseStage: "stable" },
        { provider: "linear", releaseStage: "stable" },
        { provider: "intercom", releaseStage: "beta", betaAccess: "all_organizations" },
        { provider: "github", releaseStage: "beta", betaAccess: "all_organizations" },
        { provider: "custom", releaseStage: "beta", betaAccess: "allowlist" },
      ],
    });
    acme = (await prisma.organization.create({ data: { name: "Acme" } })).id;
    globex = (await prisma.organization.create({ data: { name: "Globex" } })).id;
    auth.session = sessionFor(OPERATOR, "member");
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const auditRows = () => prisma.adminAuditLog.findMany({ orderBy: { createdAt: "asc" } });
  const patch = (provider: string, body: unknown) => providerRoute.PATCH(request(`/api/admin/integrations/providers/${provider}`, "PATCH", body), params({ provider }));
  const addToList = (provider: string, organizationId: string, reason = "pilot") =>
    allowlistRoute.POST(request(`/api/admin/integrations/providers/${provider}/allowlist`, "POST", { organizationId, reason }), params({ provider }));
  const removeFromList = (provider: string, organizationId: string, reason = "pilot over") =>
    allowlistEntryRoute.DELETE(request(`/api/admin/integrations/providers/${provider}/allowlist/${organizationId}`, "DELETE", { reason }), params({ provider, organizationId }));

  describe("authorization", () => {
    const everyWrite = () => [
      () => listRoute.GET(),
      () => patch("zendesk", { expectedVersion: 0, enabled: false, reason: "x" }),
      () => impactRoute.POST(request("/api/admin/integrations/providers/zendesk/impact", "POST", { enabled: false }), params({ provider: "zendesk" })),
      () => addToList("intercom", acme),
      () => removeFromList("custom", acme),
      () => legacyRoute.POST(request(`/api/admin/tenants/${acme}/custom-provider`, "POST", { enabled: false, reason: "x" }), params({ organizationId: acme })),
    ];

    it.each([
      ["an organization owner", () => sessionFor("owner@acme.test", "owner", "acme")],
      ["an organization member", () => sessionFor("member@acme.test", "member", "acme")],
    ])("%s gets 403 everywhere and changes nothing", async (_who, session) => {
      auth.session = session();
      for (const call of everyWrite()) expect((await call()).status).toBe(403);
      expect(await auditRows()).toHaveLength(0);
      expect(await prisma.integrationAvailability.findUniqueOrThrow({ where: { provider: "zendesk" } })).toMatchObject({ enabled: true, version: 0 });
    });

    it("signed out gets 401 everywhere", async () => {
      auth.session = null;
      for (const call of everyWrite()) expect((await call()).status).toBe(401);
    });
  });

  describe("policy changes", () => {
    it("persists a disable with one audit row holding operator, provider, before, after and reason", async () => {
      const response = await patch("zendesk", { expectedVersion: 0, enabled: false, statusMessage: "Provider incident", reason: "Zendesk API errors" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ changed: true, policy: { enabled: false, version: 1 } });

      expect(await prisma.integrationAvailability.findUniqueOrThrow({ where: { provider: "zendesk" } })).toMatchObject({
        enabled: false,
        statusMessage: "Provider incident",
        version: 1,
        updatedByEmail: OPERATOR,
      });
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorEmail: OPERATOR, action: "update_integration_availability", organizationId: null, integrationId: null });
      expect(rows[0]!.metadata).toEqual({
        provider: "zendesk",
        before: { enabled: true, releaseStage: "stable", betaAccess: "allowlist", statusMessage: null },
        after: { enabled: false, releaseStage: "stable", betaAccess: "allowlist", statusMessage: "Provider incident" },
        reason: "Zendesk API errors",
      });
      expect((await resolve(prisma, acme, "zendesk")).available).toBe(false);
    });

    it("a request that changes nothing writes nothing", async () => {
      const response = await patch("zendesk", { expectedVersion: 0, enabled: true, reason: "no-op" });
      expect(await response.json()).toMatchObject({ changed: false });
      expect(await auditRows()).toHaveLength(0);
      expect((await prisma.integrationAvailability.findUniqueOrThrow({ where: { provider: "zendesk" } })).version).toBe(0);
    });

    it.each([
      [{ expectedVersion: 0, enabled: false }, 400],
      [{ expectedVersion: 0, enabled: false, reason: "   " }, 400],
      [{ enabled: false, reason: "x" }, 400],
      [{ expectedVersion: 0, releaseStage: "disabled", reason: "x" }, 400],
      [{ expectedVersion: 0, reason: "x" }, 400],
    ])("rejects an invalid body %j with %i and writes nothing", async (body, status) => {
      expect((await patch("zendesk", body)).status).toBe(status);
      expect(await auditRows()).toHaveLength(0);
    });

    it("404s an unknown provider", async () => {
      expect((await patch("slack", { expectedVersion: 0, enabled: false, reason: "x" })).status).toBe(404);
    });

    it("of two concurrent edits from the same version, exactly one wins and the other is 409 stale_version", async () => {
      const [a, b] = await Promise.all([
        patch("jira", { expectedVersion: 0, enabled: false, reason: "operator A" }),
        patch("jira", { expectedVersion: 0, releaseStage: "coming_soon", reason: "operator B" }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(await loser.json()).toMatchObject({ code: "stale_version" });
      expect(await auditRows()).toHaveLength(1);
      expect((await prisma.integrationAvailability.findUniqueOrThrow({ where: { provider: "jira" } })).version).toBe(1);
    });

    it("an edit from an old page is refused rather than overwriting a newer change", async () => {
      expect((await patch("linear", { expectedVersion: 0, enabled: false, reason: "first" })).status).toBe(200);
      const stale = await patch("linear", { expectedVersion: 0, statusMessage: "old tab", reason: "second" });
      expect(stale.status).toBe(409);
      expect(await prisma.integrationAvailability.findUniqueOrThrow({ where: { provider: "linear" } })).toMatchObject({ enabled: false, statusMessage: null });
    });

    it("creates a missing row from the catalog default inside the same change", async () => {
      await prisma.integrationAvailability.delete({ where: { provider: "github" } });
      expect((await patch("github", { expectedVersion: 0, releaseStage: "coming_soon", reason: "x" })).status).toBe(200);
      expect(await prisma.integrationAvailability.findUniqueOrThrow({ where: { provider: "github" } })).toMatchObject({ releaseStage: "coming_soon", betaAccess: "all_organizations", version: 1 });
    });
  });

  describe("Custom REST rollout block (N9.14-F1, D33 ruling 3)", () => {
    it.each([
      [{ releaseStage: "stable" }],
      [{ betaAccess: "all_organizations" }],
      [{ releaseStage: "stable", betaAccess: "all_organizations" }],
    ])("refuses %j with 409 rollout_blocked and writes nothing", async (change) => {
      const response = await patch("custom", { expectedVersion: 0, ...change, reason: "widen" });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe("rollout_blocked");
      expect(body.error).toContain("N9.14-F1");
      expect(await auditRows()).toHaveLength(0);
      expect(await prisma.integrationAvailability.findUniqueOrThrow({ where: { provider: "custom" } })).toMatchObject({ releaseStage: "beta", betaAccess: "allowlist", version: 0 });
    });

    it("refuses adding any organization to the allowlist, through the new and the legacy route", async () => {
      expect(await (await addToList("custom", acme)).json()).toMatchObject({ code: "rollout_blocked" });
      const legacy = await legacyRoute.POST(request(`/api/admin/tenants/${acme}/custom-provider`, "POST", { enabled: true, reason: "x" }), params({ organizationId: acme }));
      expect(legacy.status).toBe(409);
      expect(await prisma.integrationBetaAllowlist.count()).toBe(0);
      expect(await auditRows()).toHaveLength(0);
    });

    it("still allows narrowing: disable, Coming Soon, and removing an organization (which also pauses its polling)", async () => {
      // An organization already on the list (as the migration carries over an old flag).
      await prisma.integrationBetaAllowlist.create({ data: { provider: "custom", organizationId: acme, addedByEmail: "migration:n10" } });
      const integration = await prisma.integration.create({ data: { organizationId: acme, provider: "custom", credentials: {} } });

      expect((await patch("custom", { expectedVersion: 0, enabled: false, reason: "maintenance" })).status).toBe(200);
      expect((await patch("custom", { expectedVersion: 1, enabled: true, releaseStage: "coming_soon", reason: "hold" })).status).toBe(200);
      expect((await patch("custom", { expectedVersion: 2, releaseStage: "beta", reason: "back to Beta allowlist" })).status).toBe(200);

      const removed = await removeFromList("custom", acme, "end pilot");
      expect(await removed.json()).toEqual({ pausedPolling: true });
      expect(await prisma.integration.findUniqueOrThrow({ where: { id: integration.id } })).toMatchObject({ status: "connected", credentials: {} });
      expect((await prisma.integration.findUniqueOrThrow({ where: { id: integration.id } })).pollingPausedAt).not.toBeNull();
      expect((await auditRows()).map((r) => r.action)).toEqual([
        "update_integration_availability",
        "update_integration_availability",
        "update_integration_availability",
        "remove_integration_allowlist",
      ]);
    });
  });

  describe("Beta allowlist (D33 ruling 4)", () => {
    it("restricts a Beta provider to listed organizations, per organization, with one audit row per change", async () => {
      expect((await patch("intercom", { expectedVersion: 0, betaAccess: "allowlist", reason: "limit pilot" })).status).toBe(200);
      expect((await resolve(prisma, acme, "intercom")).available).toBe(false);

      expect((await addToList("intercom", acme)).status).toBe(201);
      expect((await resolve(prisma, acme, "intercom")).available).toBe(true);
      expect(await resolve(prisma, globex, "intercom")).toMatchObject({ available: false, code: "integration_beta_restricted" });

      expect(await (await addToList("intercom", acme)).json()).toMatchObject({ code: "already_listed" });
      expect((await removeFromList("intercom", acme)).status).toBe(200);
      expect((await resolve(prisma, acme, "intercom")).available).toBe(false);
      expect(await (await removeFromList("intercom", acme)).json()).toMatchObject({ code: "not_listed" });

      const rows = await auditRows();
      expect(rows.map((r) => r.action)).toEqual(["update_integration_availability", "add_integration_allowlist", "remove_integration_allowlist"]);
      expect(rows[1]).toMatchObject({ organizationId: acme, metadata: { provider: "intercom", organizationId: acme, reason: "pilot" } });
    });

    it("previews who loses access before the change, without writing", async () => {
      await prisma.integration.create({ data: { organizationId: acme, provider: "intercom", credentials: {} } });
      await prisma.integration.create({ data: { organizationId: globex, provider: "intercom", credentials: {} } });
      await prisma.integrationBetaAllowlist.create({ data: { provider: "intercom", organizationId: acme, addedByEmail: OPERATOR } });

      const response = await impactRoute.POST(request("/api/admin/integrations/providers/intercom/impact", "POST", { betaAccess: "allowlist" }), params({ provider: "intercom" }));
      expect(await response.json()).toEqual({ organizationsLosingAccess: [{ id: globex, name: "Globex", connections: 1 }], connectionsAffected: 1 });
      expect(await auditRows()).toHaveLength(0);
      expect((await prisma.integrationAvailability.findUniqueOrThrow({ where: { provider: "intercom" } })).betaAccess).toBe("all_organizations");
    });
  });

  describe("data preservation (D33)", () => {
    it("disabling and re-enabling leaves integrations, credentials, raw events and cases exactly as they were", async () => {
      const integration = await prisma.integration.create({
        data: { organizationId: acme, provider: "zendesk", credentials: { subdomain: "acme", accessToken: "enc:v1:opaque" }, webhookSecret: "whsec_1", cursor: { tickets: { startTime: 1 } } },
      });
      await prisma.rawEvent.create({ data: { integrationId: integration.id, providerEventId: "ticket:1", sourceHash: "h", payload: { id: 1 } } });
      await prisma.case.create({ data: { organizationId: acme, externalId: "1", system: "zendesk", sourceIntegrationId: integration.id, openedAt: new Date("2026-10-01T00:00:00Z") } });
      const snapshot = async () =>
        JSON.stringify({
          integrations: await prisma.integration.findMany({ orderBy: { id: "asc" } }),
          rawEvents: await prisma.rawEvent.findMany({ orderBy: { id: "asc" } }),
          cases: await prisma.case.findMany({ orderBy: { id: "asc" } }),
        });
      const before = await snapshot();

      expect((await patch("zendesk", { expectedVersion: 0, enabled: false, reason: "incident" })).status).toBe(200);
      expect(await snapshot()).toBe(before);
      expect((await patch("zendesk", { expectedVersion: 1, enabled: true, reason: "resolved" })).status).toBe(200);
      expect(await snapshot()).toBe(before);

      // The audit log never carries a credential.
      expect(JSON.stringify(await auditRows())).not.toMatch(/accessToken|whsec_1|enc:v1/);
    });

    it("lists every provider with counts and health, never credentials", async () => {
      await prisma.integration.create({ data: { organizationId: acme, provider: "zendesk", credentials: { accessToken: "enc:v1:secret" }, lastSuccessfulSyncAt: new Date() } });
      await prisma.integration.create({ data: { organizationId: globex, provider: "zendesk", credentials: {}, status: "reauth_required" } });
      const response = await listRoute.GET();
      const body = await response.json();
      expect(body.rows.map((r: { provider: string }) => r.provider).sort()).toEqual(["custom", "github", "intercom", "jira", "linear", "zendesk"]);
      const zendesk = body.rows.find((r: { provider: string }) => r.provider === "zendesk");
      expect(zendesk).toMatchObject({ connections: 2, activeOrganizations: 2, pausedConnections: 0, health: { healthy: 1, needsAttention: 1 } });
      expect(body.rows.find((r: { provider: string }) => r.provider === "custom").rolloutBlock.id).toBe("N9.14-F1");
      expect(JSON.stringify(body)).not.toContain("enc:v1:secret");
    });
  });
});
