/**
 * `GET /api/integrations/jira/callback` (roadmap task 2.7): reconnecting to
 * a *different* Jira site than the one already connected is refused once
 * any RawEvent history exists, allowed when there's none yet (same as a
 * fresh connect), and reconnecting to the *same* site always goes through
 * unchanged. Unlike Zendesk's subdomain (chosen by the user before the OAuth
 * redirect), the target site is only known after `exchangeCodeForToken`, so
 * this check runs after the exchange rather than before it.
 *
 * Fully mocked (`@sla/db`, `@sla/jira`, `next-auth`, `@/lib/auth`,
 * `@/lib/jira-env`, `@/lib/oauth-state`) — no Postgres needed, mirroring
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
const jiraMock = vi.hoisted(() => ({
  exchangeCodeForToken: vi.fn(async () => ({
    cloudId: "cloud-new",
    siteUrl: "https://new-site.atlassian.net",
    accessToken: "access-new",
    tokenType: "bearer",
    scope: "read:jira-work",
  })),
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/jira-env", () => ({
  JIRA_STATE_COOKIE: "jira_oauth_state",
  getJiraOAuthConfig: vi.fn(async () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://app.example.com/api/integrations/jira/callback" })),
}));
vi.mock("@/lib/oauth-state", () => ({
  // Owner-session flow only: the connect-link branch is exercised in connect-link-callback.test.ts.
  verifyOAuthState: vi.fn(() => null),
  validateOAuthState: vi.fn(({ returnedState }: { returnedState: string | null }) => {
    if (!returnedState) return { ok: false, status: 400, error: "Invalid or expired OAuth state" };
    const state = JSON.parse(returnedState) as { organizationId: string; userId: string };
    return { ok: true, state };
  }),
}));
vi.mock("@sla/jira", () => ({
  exchangeCodeForToken: jiraMock.exchangeCodeForToken,
  generateWebhookSecret: vi.fn(() => "webhook-secret"),
}));
vi.mock("@sla/db", () => ({
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

function callbackRequest(organizationId: string) {
  const state = JSON.stringify({ organizationId, userId: "user-1" });
  const url = `http://localhost/api/integrations/jira/callback?code=auth-code&state=${encodeURIComponent(state)}`;
  return new Request(url, { headers: { cookie: `jira_oauth_state=${encodeURIComponent(state)}` } });
}

describe("GET /api/integrations/jira/callback — site-switch refusal", () => {
  beforeEach(() => {
    vi.resetModules();
    db.findUnique.mockReset();
    db.upsert.mockReset();
    db.updateMany.mockReset();
    db.findFirstRawEvent.mockReset();
    jiraMock.exchangeCodeForToken.mockReset();
    jiraMock.exchangeCodeForToken.mockResolvedValue({
      cloudId: "cloud-new",
      siteUrl: "https://new-site.atlassian.net",
      accessToken: "access-new",
      tokenType: "bearer",
      scope: "read:jira-work",
    });
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

    const { GET } = await import("../src/app/api/integrations/jira/callback/route");
    const response = await GET(callbackRequest("org-1"));

    expect(db.findFirstRawEvent).not.toHaveBeenCalled();
    expect(db.upsert).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
  });

  it("reconnecting to the SAME site (same cloudId) always goes through, history or not", async () => {
    jiraMock.exchangeCodeForToken.mockResolvedValue({
      cloudId: "cloud-existing",
      siteUrl: "https://existing.atlassian.net",
      accessToken: "access-same",
      tokenType: "bearer",
      scope: "read:jira-work",
    });
    db.findUnique.mockResolvedValue({ id: "int-1", credentials: { cloudId: "cloud-existing", siteUrl: "https://existing.atlassian.net" } });
    db.upsert.mockResolvedValue({});
    db.updateMany.mockResolvedValue({ count: 0 });

    const { GET } = await import("../src/app/api/integrations/jira/callback/route");
    const response = await GET(callbackRequest("org-1"));

    expect(db.findFirstRawEvent).not.toHaveBeenCalled(); // same site — no switch to check
    expect(db.upsert).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
  });

  it("refuses a different site (different cloudId) with existing RawEvent history", async () => {
    db.findUnique.mockResolvedValue({ id: "int-1", credentials: { cloudId: "cloud-existing", siteUrl: "https://existing.atlassian.net" } });
    db.findFirstRawEvent.mockResolvedValue({ id: "raw-1" });

    const { GET } = await import("../src/app/api/integrations/jira/callback/route");
    const response = await GET(callbackRequest("org-1"));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/existing\.atlassian\.net/);
    expect(body.error).toMatch(/new-site\.atlassian\.net/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("allows a different site when the existing integration has zero history", async () => {
    db.findUnique.mockResolvedValue({ id: "int-1", credentials: { cloudId: "cloud-existing", siteUrl: "https://existing.atlassian.net" } });
    db.findFirstRawEvent.mockResolvedValue(null);
    db.upsert.mockResolvedValue({});
    db.updateMany.mockResolvedValue({ count: 0 });

    const { GET } = await import("../src/app/api/integrations/jira/callback/route");
    const response = await GET(callbackRequest("org-1"));

    expect(response.status).toBe(307);
    expect(db.upsert).toHaveBeenCalledTimes(1);
  });
});
