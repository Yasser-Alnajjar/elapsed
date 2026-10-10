/**
 * N10 (D33) runtime enforcement against a real Postgres, through the real
 * route handlers: while a provider is unavailable to an organization, no
 * connect, OAuth completion, connect link, configuration write, import,
 * webhook, concierge export or Custom REST call reaches the provider or
 * stores anything; webhooks are acknowledged (200) and ignored; disconnect and
 * reads still work; and re-enabling lets the same requests through again.
 * Platform unavailability never changes the customer's own integration row.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"
 * (every test truncates all tables). Skipped when unset.
 */
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const providerCalls = vi.hoisted(() => ({ exchange: 0, webhookIngest: 0, backfill: 0 }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("server-only", () => ({}));
// Any call that would reach Zendesk is counted, never made.
vi.mock("@sla/zendesk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sla/zendesk")>()),
  exchangeCodeForToken: vi.fn(async () => {
    providerCalls.exchange += 1;
    return { accessToken: "token", subdomain: "acme" };
  }),
  runZendeskWebhookIngest: vi.fn(async () => {
    providerCalls.webhookIngest += 1;
    return { ticketsFetched: 0, ticketAuditsFetched: 0 };
  }),
  runZendeskBackfill: vi.fn(async () => {
    providerCalls.backfill += 1;
    return {};
  }),
}));

const request = (url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", origin: "http://localhost", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

describe.skipIf(!TEST_DATABASE_URL)("integration availability enforcement on provider routes (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("@sla/db");
  let organizationId: string;
  let userId: string;
  let zendeskId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXTAUTH_SECRET ??= "n10-test-secret-n10-test-secret-0123";
    process.env.NEXTAUTH_URL ??= "http://localhost";
    db = await import("@sla/db");
    prisma = db.getPrismaClient();
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    providerCalls.exchange = 0;
    providerCalls.webhookIngest = 0;
    providerCalls.backfill = 0;
    const org = await prisma.organization.create({
      data: { name: "Acme", users: { create: { email: "owner@acme.test", passwordHash: "x", role: "owner" } } },
      include: { users: true },
    });
    organizationId = org.id;
    userId = org.users[0]!.id;
    zendeskId = (
      await prisma.integration.create({
        data: { organizationId, provider: "zendesk", credentials: { subdomain: "acme" }, webhookSecret: "whsec_acme" },
      })
    ).id;
    auth.session = {
      expires: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: userId, organizationId, email: "owner@acme.test", emailVerifiedAt: new Date(), name: null, image: null, role: "owner", createdAt: new Date() },
    } as Session;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const setZendesk = (data: { enabled?: boolean; releaseStage?: "stable" | "beta" | "coming_soon" }) =>
    prisma.integrationAvailability.upsert({ where: { provider: "zendesk" }, create: { provider: "zendesk", releaseStage: "stable", ...data }, update: data });
  const integrationRow = () => prisma.integration.findUniqueOrThrow({ where: { id: zendeskId } });

  it("connect redirects to the integrations page with the reason, for Disabled and Coming Soon", async () => {
    const route = await import("../src/app/api/integrations/zendesk/connect/route");
    await setZendesk({ enabled: false });
    let response = await route.GET(request("/api/integrations/zendesk/connect?subdomain=acme"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/settings/integrations?availability=integration_disabled&provider=zendesk");

    await setZendesk({ enabled: true, releaseStage: "coming_soon" });
    response = await route.GET(request("/api/integrations/zendesk/connect?subdomain=acme"));
    expect(response.headers.get("location")).toContain("availability=integration_coming_soon");
  });

  it("an OAuth flow started before the disable does not complete: no code exchange, no credentials stored", async () => {
    const { signOAuthState } = await import("../src/lib/oauth-state");
    const route = await import("../src/app/api/integrations/zendesk/callback/route");
    await prisma.integration.delete({ where: { id: zendeskId } });
    const state = signOAuthState({ nonce: "n", organizationId, userId, subdomain: "acme" });
    await setZendesk({ enabled: false });

    const response = await route.GET(
      request(`/api/integrations/zendesk/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { cookie: `zendesk_oauth_state=${state}` } }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("availability=integration_disabled");
    expect(providerCalls.exchange).toBe(0);
    expect(await prisma.integration.count()).toBe(0);
  });

  it("a reconnect is refused too (an existing, disconnected row stays disconnected)", async () => {
    const { signOAuthState } = await import("../src/lib/oauth-state");
    const route = await import("../src/app/api/integrations/zendesk/callback/route");
    await prisma.integration.update({ where: { id: zendeskId }, data: { status: "disconnected", disconnectedAt: new Date(), credentials: undefined } });
    const before = await integrationRow();
    const state = signOAuthState({ nonce: "n", organizationId, userId, subdomain: "acme" });
    await setZendesk({ enabled: false });

    await route.GET(request(`/api/integrations/zendesk/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { cookie: `zendesk_oauth_state=${state}` } }));
    expect(providerCalls.exchange).toBe(0);
    expect(await integrationRow()).toEqual(before);
  });

  it("connect links: creating one is refused; opening a valid one does not start OAuth or consume it", async () => {
    await prisma.integrationAvailability.create({ data: { provider: "jira", enabled: false, releaseStage: "stable" } });
    const create = await import("../src/app/api/integrations/connect-links/route");
    const created = await create.POST(request("/api/integrations/connect-links", { method: "POST", body: { provider: "jira" } }));
    expect(created.status).toBe(403);
    expect(await created.json()).toMatchObject({ code: "integration_disabled", provider: "jira" });

    const { token } = await db.createConnectLink(prisma, { organizationId, provider: "jira", createdByUserId: userId });
    const start = await import("../src/app/api/integrations/connect-links/[token]/start/route");
    const response = await start.GET(request(`/api/integrations/connect-links/${token}/start`), params({ token }));
    expect(response.headers.get("location")).toContain(`/connect/${token}`);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("jira_oauth_state");
    await expect(db.resolveConnectLink(prisma, token)).resolves.toMatchObject({ provider: "jira" });
  });

  it("OAuth app configuration: writes are refused, reads still work; Slack is untouched (N10 ruling 7)", async () => {
    const route = await import("../src/app/api/integrations/zendesk/config/route");
    await setZendesk({ enabled: false });
    expect((await route.POST(request("/api/integrations/zendesk/config", { method: "POST", body: { clientId: "id", clientSecret: "s" } }))).status).toBe(403);
    expect((await route.DELETE()).status).toBe(403);
    expect((await route.GET()).status).toBe(200);
    expect(await prisma.integrationConfig.count()).toBe(0);

    // Slack is not gated: whatever it answers, it is never the availability refusal.
    const slack = await import("../src/app/api/integrations/slack/config/route");
    const slackResponse = await slack.POST(request("/api/integrations/slack/config", { method: "POST", body: { clientId: "id", clientSecret: "s" } }));
    expect(slackResponse.status).not.toBe(403);
    expect(await slackResponse.json()).not.toHaveProperty("code");
  });

  it("manual import is refused with the documented error", async () => {
    const route = await import("../src/app/api/integrations/zendesk/backfill/route");
    await setZendesk({ enabled: false });
    const response = await route.POST();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Zendesk is temporarily unavailable. Your existing data is kept.",
      code: "integration_disabled",
      provider: "zendesk",
      statusMessage: null,
    });
    expect(providerCalls.backfill).toBe(0);
  });

  it("a webhook is acknowledged (200) and ignored: nothing is fetched or stored", async () => {
    const route = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");
    await setZendesk({ enabled: false });
    const response = await route.POST(
      request(`/api/webhooks/zendesk/${zendeskId}`, {
        method: "POST",
        headers: { authorization: "Bearer whsec_acme" },
        body: { ticket_id: 7, timestamp: new Date().toISOString() },
      }),
      params({ integrationId: zendeskId }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored", reason: "integration_disabled" });
    expect(providerCalls.webhookIngest).toBe(0);
    expect(await prisma.rawEvent.count()).toBe(0);
    // A bad secret is still rejected first: availability never weakens authentication.
    const forged = await route.POST(
      request(`/api/webhooks/zendesk/${zendeskId}`, { method: "POST", headers: { authorization: "Bearer wrong" }, body: { ticket_id: 7 } }),
      params({ integrationId: zendeskId }),
    );
    expect(forged.status).toBe(401);
  });

  it("a concierge export makes no provider call", async () => {
    const route = await import("../src/app/api/concierge/zendesk/export/route");
    await setZendesk({ enabled: false });
    const response = await route.POST(
      request("/api/concierge/zendesk/export", { method: "POST", body: { organizationId, zendeskIntegrationId: zendeskId, sinceDays: 30 } }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "integration_disabled" });
  });

  it("Custom REST routes follow the Beta allowlist; status and disconnect stay reachable", async () => {
    const draft = await import("../src/app/api/integrations/custom/draft/route");
    const status = await import("../src/app/api/integrations/custom/status/route");
    const test = await import("../src/app/api/integrations/custom/test/route");

    let response = await draft.GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "integration_beta_restricted", provider: "custom" });
    expect((await test.POST()).status).toBe(403);
    expect((await status.GET()).status).toBe(200);

    await prisma.integrationBetaAllowlist.create({ data: { provider: "custom", organizationId, addedByEmail: "ops@elapsed.test" } });
    expect((await draft.GET()).status).toBe(200);

    await prisma.integrationAvailability.create({ data: { provider: "custom", enabled: false, releaseStage: "beta", betaAccess: "allowlist" } });
    response = await draft.GET();
    expect(await response.json()).toMatchObject({ code: "integration_disabled" });
  });

  it("never touches the customer's integration row, and re-enabling lets every path through again", async () => {
    const before = await integrationRow();
    const backfill = await import("../src/app/api/integrations/zendesk/backfill/route");
    const webhook = await import("../src/app/api/webhooks/zendesk/[integrationId]/route");
    const connect = await import("../src/app/api/integrations/zendesk/connect/route");

    await setZendesk({ enabled: false });
    expect((await backfill.POST()).status).toBe(403);
    expect(await integrationRow()).toEqual(before);

    await setZendesk({ enabled: true });
    // Past the availability gate, each route behaves as it always did (here: no OAuth app configured).
    const resumed = await backfill.POST();
    expect(resumed.status).not.toBe(403);
    expect(await resumed.json()).not.toHaveProperty("code", "integration_disabled");
    const connectResponse = await connect.GET(request("/api/integrations/zendesk/connect?subdomain=acme"));
    expect(connectResponse.headers.get("location") ?? "").not.toContain("availability=");
    const hook = await webhook.POST(
      request(`/api/webhooks/zendesk/${zendeskId}`, { method: "POST", headers: { authorization: "Bearer whsec_acme" }, body: { ticket_id: 7, timestamp: new Date().toISOString() } }),
      params({ integrationId: zendeskId }),
    );
    expect(await hook.json()).not.toMatchObject({ status: "ignored" });
    expect(await integrationRow()).toMatchObject({ status: before.status, credentials: before.credentials, webhookSecret: before.webhookSecret });
  });
});
