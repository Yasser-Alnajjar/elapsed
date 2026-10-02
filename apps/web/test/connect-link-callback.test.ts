/**
 * Jira callback with a connect link and no session (N5.3, D26). `@sla/db` and
 * the provider package are mocked; the OAuth state signing is real.
 */
import { scryptSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.NEXTAUTH_SECRET = "test-secret-for-connect-link";
process.env.NEXTAUTH_URL = "https://app.example.com";

const db = vi.hoisted(() => ({
  upsert: vi.fn(async () => ({})),
  updateMany: vi.fn(async () => ({})),
  findUnique: vi.fn(async () => null),
  consume: vi.fn(async () => true),
  resolveById: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/jira-env", () => ({
  JIRA_STATE_COOKIE: "jira_oauth_state",
  getJiraOAuthConfig: vi.fn(async () => ({ clientId: "id", clientSecret: "s", redirectUri: "r" })),
}));
vi.mock("@sla/jira", () => ({
  exchangeCodeForToken: vi.fn(async () => ({ cloudId: "c", siteUrl: "https://x.atlassian.net", accessToken: "a", tokenType: "bearer", scope: "read:jira-work" })),
  generateWebhookSecret: vi.fn(() => "wh"),
}));
vi.mock("@sla/db", () => {
  class ConnectLinkError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  return {
    ConnectLinkError,
    isConnectLinkProvider: (v: unknown) => v === "jira" || v === "linear",
    connectLinkLabel: (l: { intendedFor: string | null }) => `connect link${l.intendedFor ? `: ${l.intendedFor}` : ""}`,
    consumeConnectLink: db.consume,
    resolveConnectLinkById: db.resolveById,
    deriveEncryptionKey: (secret: string, salt: string) => scryptSync(secret, salt, 32),
    encryptCredentials: (c: unknown) => c,
    getPrismaClient: () => ({ integration: { findUnique: db.findUnique, upsert: db.upsert, updateMany: db.updateMany }, rawEvent: { findFirst: vi.fn() } }),
  };
});

import { signOAuthState } from "@/lib/oauth-state";
import { GET } from "@/app/api/integrations/jira/callback/route";

const link = { id: "l1", organizationId: "org-1", organizationName: "Org", provider: "jira", intendedFor: "Dana", expiresAt: new Date(Date.now() + 1e6) };

function request(state: string | null, withCookie = true) {
  const url = `http://localhost/api/integrations/jira/callback?code=c${state ? `&state=${encodeURIComponent(state)}` : ""}`;
  return new Request(url, { headers: state && withCookie ? { cookie: `jira_oauth_state=${state}` } : {} });
}

const linkState = (over: Record<string, unknown> = {}) =>
  signOAuthState({ nonce: "n", organizationId: "org-1", userId: "connect-link:l1", connectLinkId: "l1", provider: "jira", ...over });

describe("jira callback via connect link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.consume.mockResolvedValue(true);
    db.resolveById.mockResolvedValue(link);
  });

  it("connects without a session, consumes the link, records connectedBy", async () => {
    const response = await GET(request(linkState()));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.com/connect/done");
    expect(db.consume).toHaveBeenCalledWith(expect.anything(), { id: "l1", organizationId: "org-1", provider: "jira" });
    const call = db.upsert.mock.calls[0] as unknown as [{ create: { organizationId: string; connectedBy: string } }];
    expect(call[0].create).toMatchObject({ organizationId: "org-1", connectedBy: "connect link: Dana" });
  });

  it("stores nothing when the link was already consumed (410)", async () => {
    db.consume.mockResolvedValue(false);
    const response = await GET(request(linkState()));
    expect(response.status).toBe(410);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("refuses a link state minted for another provider", async () => {
    const response = await GET(request(linkState({ provider: "linear" })));
    expect(response.status).toBe(403);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("refuses a state whose organization differs from the link's", async () => {
    const response = await GET(request(linkState({ organizationId: "org-2" })));
    expect(response.status).toBe(403);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("refuses a forged (unsigned) state and a missing cookie", async () => {
    expect((await GET(request("e30.forged"))).status).toBe(307);
    expect((await GET(request(linkState(), false))).status).toBe(307);
    expect(db.upsert).not.toHaveBeenCalled();
  });
});
