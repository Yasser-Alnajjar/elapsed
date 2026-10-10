/**
 * Regression: the Intercom authorize request must carry this deployment's own
 * `redirect_uri` (from NEXTAUTH_URL). Without it Intercom falls back to the
 * first URL registered in the Developer Hub — in production that was the
 * localhost one. Mocked (`@sla/db`, `next-auth`, entitlements) — no Postgres.
 */
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  session: { user: { id: "u1", organizationId: "org1", role: "owner" } } as unknown as Session,
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/entitlements", () => ({
  gateIntegrationConnect: vi.fn(async () => ({ proceed: true })),
  blockedConnectRedirect: vi.fn(() => "/blocked"),
}));
vi.mock("@/lib/oauth-state", () => ({ signOAuthState: vi.fn(() => "signed-state") }));
vi.mock("@sla/db", () => ({
  // D33: every provider available; these fakes have no availability tables.
  resolveIntegrationAvailability: vi.fn(async (_db: unknown, _org: string, provider: string) => ({ available: true, provider, releaseStage: "stable" })),
  getPrismaClient: vi.fn(() => ({})),
  getIntegrationConfig: vi.fn(async () => ({ clientId: "client-123", clientSecret: "secret-xyz" })),
}));

const CALLBACK_PATH = "/api/integrations/intercom/callback";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", "https://sla.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Intercom redirect URI resolution", () => {
  it("builds the callback from NEXTAUTH_URL, never a hardcoded host", async () => {
    const { getIntercomRedirectUri } = await import("@/lib/intercom-redirect");

    expect(getIntercomRedirectUri()).toBe(`https://sla.example.com${CALLBACK_PATH}`);

    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
    expect(getIntercomRedirectUri()).toBe(`http://localhost:3000${CALLBACK_PATH}`);
  });

  it("throws when NEXTAUTH_URL is unset rather than guessing a host", async () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    const { getIntercomRedirectUri } = await import("@/lib/intercom-redirect");

    expect(() => getIntercomRedirectUri()).toThrow("NEXTAUTH_URL is not configured");
  });

  it("puts the resolved redirect_uri on the authorize URL the connect route redirects to", async () => {
    const { GET } = await import("../src/app/api/integrations/intercom/connect/route");

    const response = await GET(new Request("http://0.0.0.0:3000/api/integrations/intercom/connect"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin).toBe("https://app.intercom.com");
    expect(location.searchParams.get("client_id")).toBe("client-123");
    expect(location.searchParams.get("redirect_uri")).toBe(`https://sla.example.com${CALLBACK_PATH}`);
  });
});
