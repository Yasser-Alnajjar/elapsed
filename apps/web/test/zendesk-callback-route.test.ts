/**
 * `GET /api/integrations/zendesk/callback` (roadmap task 2.7): reconnecting
 * to a *different* Zendesk subdomain than the one already connected is
 * refused once any RawEvent history exists, allowed when there's none yet
 * (same as a fresh connect), and reconnecting to the *same* subdomain always
 * goes through unchanged.
 *
 * Fully mocked (`@sla/db`, `@sla/zendesk`, `next-auth`, `@/lib/auth`,
 * `@/lib/zendesk-env`, `@/lib/oauth-state`) — no Postgres needed, mirroring
 * `worker-settings-route.test.ts`'s Pattern A shape.
 */
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findFirstRawEvent: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/zendesk-env", () => ({
  ZENDESK_STATE_COOKIE: "zendesk_oauth_state",
  getZendeskOAuthConfig: vi.fn(async () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://app.example.com/api/integrations/zendesk/callback" })),
}));
vi.mock("@/lib/oauth-state", () => ({
  validateOAuthState: vi.fn(({ returnedState }: { returnedState: string | null }) => {
    if (!returnedState) return { ok: false, status: 400, error: "Invalid or expired OAuth state" };
    const state = JSON.parse(returnedState) as { subdomain: string; organizationId: string; userId: string };
    return { ok: true, state };
  }),
}));
vi.mock("@sla/zendesk", () => ({
  exchangeCodeForToken: vi.fn(async () => ({
    subdomain: "new-subdomain-from-token-exchange",
    accessToken: "access-new",
    tokenType: "bearer",
    scope: "read",
  })),
  generateWebhookSecret: vi.fn(() => "webhook-secret"),
}));
vi.mock("@sla/db", () => ({
  // D33: every provider available; these fakes have no availability tables.
  resolveIntegrationAvailability: vi.fn(async (_db: unknown, _org: string, provider: string) => ({ available: true, provider, releaseStage: "stable" })),
  getPrismaClient: vi.fn(() => ({
    integration: {
      findUnique: db.findUnique,
      upsert: db.upsert,
      updateMany: db.updateMany,
    },
    rawEvent: {
      findFirst: db.findFirstRawEvent,
    },
  })),
  encryptCredentials: vi.fn((credentials: unknown) => credentials),
}));

function sessionFor(organizationId: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email: "owner@tenant.test", emailVerifiedAt: new Date(), name: null, image: null, role: "owner", createdAt: new Date() },
  };
}

function callbackRequest(subdomain: string, organizationId: string) {
  const state = JSON.stringify({ subdomain, organizationId, userId: "user-1" });
  const url = `http://localhost/api/integrations/zendesk/callback?code=auth-code&state=${encodeURIComponent(state)}`;
  return new Request(url, { headers: { cookie: `zendesk_oauth_state=${encodeURIComponent(state)}` } });
}

describe("GET /api/integrations/zendesk/callback — subdomain-switch refusal", () => {
  beforeEach(() => {
    vi.resetModules();
    db.findUnique.mockReset();
    db.upsert.mockReset();
    db.updateMany.mockReset();
    db.findFirstRawEvent.mockReset();
    auth.session = sessionFor("org-1");
    process.env.NEXTAUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  });

  it("connects fresh (no existing integration) without any history check", async () => {
    db.findUnique.mockResolvedValue(null);
    db.upsert.mockResolvedValue({});
    db.updateMany.mockResolvedValue({ count: 0 });

    const { GET } = await import("../src/app/api/integrations/zendesk/callback/route");
    const response = await GET(callbackRequest("acme", "org-1"));

    expect(db.findFirstRawEvent).not.toHaveBeenCalled();
    expect(db.upsert).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307); // redirect
  });

  it("reconnecting to the SAME subdomain always goes through, history or not", async () => {
    db.findUnique.mockResolvedValue({ id: "int-1", credentials: { subdomain: "acme" } });
    db.upsert.mockResolvedValue({});
    db.updateMany.mockResolvedValue({ count: 0 });

    const { GET } = await import("../src/app/api/integrations/zendesk/callback/route");
    const response = await GET(callbackRequest("acme", "org-1"));

    expect(db.findFirstRawEvent).not.toHaveBeenCalled(); // same subdomain — no switch to check
    expect(db.upsert).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
  });

  it("refuses a different subdomain with existing RawEvent history", async () => {
    db.findUnique.mockResolvedValue({ id: "int-1", credentials: { subdomain: "acme" } });
    db.findFirstRawEvent.mockResolvedValue({ id: "raw-1" });

    const { GET } = await import("../src/app/api/integrations/zendesk/callback/route");
    const response = await GET(callbackRequest("other-subdomain", "org-1"));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/acme/);
    expect(body.error).toMatch(/other-subdomain/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("allows a different subdomain when the existing integration has zero history", async () => {
    db.findUnique.mockResolvedValue({ id: "int-1", credentials: { subdomain: "acme" } });
    db.findFirstRawEvent.mockResolvedValue(null);
    db.upsert.mockResolvedValue({});
    db.updateMany.mockResolvedValue({ count: 0 });

    const { GET } = await import("../src/app/api/integrations/zendesk/callback/route");
    const response = await GET(callbackRequest("other-subdomain", "org-1"));

    expect(response.status).toBe(307);
    expect(db.upsert).toHaveBeenCalledTimes(1);
  });
});
