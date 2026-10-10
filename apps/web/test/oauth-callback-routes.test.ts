/**
 * `GET /api/integrations/{provider}/callback` for all 6 providers.
 *
 * Two things this suite proves, not covered elsewhere:
 *  1. Every callback route correctly wires `validateOAuthState`'s rejection
 *     (roadmap task 2.2's signed state, bound to user + org) into an error
 *     response and never reaches the database — a thin integration check;
 *     `validateOAuthState`'s own signature/tamper/user/org logic is already
 *     exhaustively unit-tested in oauth-state.test.ts.
 *  2. GitHub, Intercom, Linear, and Slack's happy-path connect (Zendesk and
 *     Jira's happy paths are covered by their own dedicated
 *     {zendesk,jira}-callback-route.test.ts, alongside the 2.7 subdomain/
 *     site-switch behavior).
 *
 * Fully mocked (`@sla/db`, every provider package, every `@/lib/*-env`
 * module, `next-auth`, `@/lib/auth`, `@/lib/oauth-state`) — no Postgres
 * needed, mirroring `worker-settings-route.test.ts`'s Pattern A shape.
 */
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const oauthState = vi.hoisted(() => ({
  validateOAuthState: vi.fn(),
}));
const db = vi.hoisted(() => ({
  integrationFindUnique: vi.fn(),
  integrationUpsert: vi.fn(),
  integrationUpdateMany: vi.fn(),
  slackUpsert: vi.fn(),
}));
const githubMock = vi.hoisted(() => ({
  verifyRepositoryAccess: vi.fn(async () => undefined),
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/oauth-state", () => ({ validateOAuthState: oauthState.validateOAuthState, verifyOAuthState: () => null }));

vi.mock("@/lib/zendesk-env", () => ({ ZENDESK_STATE_COOKIE: "zendesk_oauth_state", getZendeskOAuthConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/jira-env", () => ({ JIRA_STATE_COOKIE: "jira_oauth_state", getJiraOAuthConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/github-env", () => ({ GITHUB_STATE_COOKIE: "github_oauth_state", getGithubOAuthConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/intercom-env", () => ({ INTERCOM_STATE_COOKIE: "intercom_oauth_state", getIntercomOAuthConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/linear-env", () => ({ LINEAR_STATE_COOKIE: "linear_oauth_state", getLinearOAuthConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/slack-env", () => ({ SLACK_STATE_COOKIE: "slack_oauth_state", getSlackOAuthConfig: vi.fn(async () => ({})) }));

vi.mock("@sla/zendesk", () => ({ exchangeCodeForToken: vi.fn(async () => ({ subdomain: "acme", accessToken: "a", tokenType: "bearer", scope: "read" })), generateWebhookSecret: vi.fn(() => "s") }));
vi.mock("@sla/jira", () => ({ exchangeCodeForToken: vi.fn(async () => ({ cloudId: "c", siteUrl: "https://acme.atlassian.net", accessToken: "a", tokenType: "bearer" })), generateWebhookSecret: vi.fn(() => "s") }));
vi.mock("@sla/github", () => ({
  exchangeCodeForToken: vi.fn(async () => ({ accessToken: "a", tokenType: "bearer", scope: "" })),
  GithubClient: vi.fn(function GithubClient(this: { verifyRepositoryAccess: typeof githubMock.verifyRepositoryAccess }) {
    this.verifyRepositoryAccess = githubMock.verifyRepositoryAccess;
  }),
  GithubPermissionDeniedError: class GithubPermissionDeniedError extends Error {},
}));
vi.mock("@sla/intercom", () => ({ exchangeCodeForToken: vi.fn(async () => ({ accessToken: "a", tokenType: "Bearer" })) }));
vi.mock("@sla/linear", () => ({ exchangeCodeForToken: vi.fn(async () => ({ accessToken: "a", tokenType: "Bearer", scope: "read" })) }));
vi.mock("@sla/slack", () => ({ exchangeCodeForToken: vi.fn(async () => ({ accessToken: "xoxb-a", teamId: "T1", teamName: "Acme", botUserId: "B1" })) }));

vi.mock("@sla/db", () => ({
  // D33: every provider available; these fakes have no availability tables.
  resolveIntegrationAvailability: vi.fn(async (_db: unknown, _org: string, provider: string) => ({ available: true, provider, releaseStage: "stable" })),
  getPrismaClient: vi.fn(() => ({
    integration: {
      findUnique: db.integrationFindUnique,
      upsert: db.integrationUpsert,
      updateMany: db.integrationUpdateMany,
    },
    slackIntegration: {
      upsert: db.slackUpsert,
    },
    rawEvent: {
      findFirst: vi.fn(async () => null),
    },
  })),
  encryptCredentials: vi.fn((credentials: unknown) => credentials),
  encryptToken: vi.fn((token: string) => token),
}));

function sessionFor(organizationId: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email: "owner@tenant.test", emailVerifiedAt: new Date(), name: null, image: null, role: "owner", createdAt: new Date() },
  };
}

function callbackRequest(cookieName: string, extraState: Record<string, unknown> = {}) {
  const state = JSON.stringify({ organizationId: "org-1", userId: "user-1", ...extraState });
  const url = `http://localhost/?code=auth-code&state=${encodeURIComponent(state)}`;
  return new Request(url, { headers: { cookie: `${cookieName}=${encodeURIComponent(state)}` } });
}

const ROUTES = [
  { provider: "zendesk", module: "../src/app/api/integrations/zendesk/callback/route", cookie: "zendesk_oauth_state", state: { subdomain: "acme" } },
  { provider: "jira", module: "../src/app/api/integrations/jira/callback/route", cookie: "jira_oauth_state", state: {} },
  { provider: "github", module: "../src/app/api/integrations/github/callback/route", cookie: "github_oauth_state", state: { repo: "acme/widgets" } },
  { provider: "intercom", module: "../src/app/api/integrations/intercom/callback/route", cookie: "intercom_oauth_state", state: {} },
  { provider: "linear", module: "../src/app/api/integrations/linear/callback/route", cookie: "linear_oauth_state", state: {} },
  { provider: "slack", module: "../src/app/api/integrations/slack/callback/route", cookie: "slack_oauth_state", state: {} },
] as const;

describe.each(ROUTES)("GET /api/integrations/$provider/callback — invalid OAuth state", ({ module, cookie, state }) => {
  beforeEach(() => {
    vi.resetModules();
    db.integrationFindUnique.mockReset();
    db.integrationUpsert.mockReset();
    db.integrationUpdateMany.mockReset();
    db.slackUpsert.mockReset();
    oauthState.validateOAuthState.mockReset();
    auth.session = sessionFor("org-1");
    process.env.NEXTAUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  });

  it("rejects with the validator's status/error and never reaches the database", async () => {
    oauthState.validateOAuthState.mockReturnValue({ ok: false, status: 403, error: "Organization mismatch" });

    const { GET } = await import(module);
    const response = await GET(callbackRequest(cookie, state));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Organization mismatch" });
    expect(db.integrationUpsert).not.toHaveBeenCalled();
    expect(db.slackUpsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/integrations/intercom/callback — happy path", () => {
  beforeEach(() => {
    vi.resetModules();
    db.integrationFindUnique.mockReset();
    db.integrationUpsert.mockReset();
    db.integrationUpdateMany.mockReset();
    oauthState.validateOAuthState.mockReset();
    oauthState.validateOAuthState.mockReturnValue({ ok: true, state: { organizationId: "org-1", userId: "user-1" } });
    db.integrationUpsert.mockResolvedValue({});
    auth.session = sessionFor("org-1");
    process.env.NEXTAUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  });

  it("upserts the Integration row and redirects to settings", async () => {
    const { GET } = await import("../src/app/api/integrations/intercom/callback/route");
    const response = await GET(callbackRequest("intercom_oauth_state"));

    expect(db.integrationUpsert).toHaveBeenCalledTimes(1);
    const call = db.integrationUpsert.mock.calls[0]![0];
    expect(call.create.provider).toBe("intercom");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/settings/integrations");
  });
});

describe("GET /api/integrations/linear/callback — happy path", () => {
  beforeEach(() => {
    vi.resetModules();
    db.integrationFindUnique.mockReset();
    db.integrationUpsert.mockReset();
    db.integrationUpdateMany.mockReset();
    oauthState.validateOAuthState.mockReset();
    oauthState.validateOAuthState.mockReturnValue({ ok: true, state: { organizationId: "org-1", userId: "user-1" } });
    db.integrationUpsert.mockResolvedValue({});
    auth.session = sessionFor("org-1");
    process.env.NEXTAUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  });

  it("upserts the Integration row and redirects to onboarding", async () => {
    const { GET } = await import("../src/app/api/integrations/linear/callback/route");
    const response = await GET(callbackRequest("linear_oauth_state"));

    expect(db.integrationUpsert).toHaveBeenCalledTimes(1);
    const call = db.integrationUpsert.mock.calls[0]![0];
    expect(call.create.provider).toBe("linear");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/onboarding");
  });
});

describe("GET /api/integrations/slack/callback — happy path", () => {
  beforeEach(() => {
    vi.resetModules();
    db.slackUpsert.mockReset();
    oauthState.validateOAuthState.mockReset();
    oauthState.validateOAuthState.mockReturnValue({ ok: true, state: { organizationId: "org-1", userId: "user-1" } });
    db.slackUpsert.mockResolvedValue({});
    auth.session = sessionFor("org-1");
    process.env.NEXTAUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  });

  it("upserts the SlackIntegration row (encrypted accessToken) and redirects", async () => {
    const { GET } = await import("../src/app/api/integrations/slack/callback/route");
    const response = await GET(callbackRequest("slack_oauth_state"));

    expect(db.slackUpsert).toHaveBeenCalledTimes(1);
    const call = db.slackUpsert.mock.calls[0]![0];
    expect(call.create).toMatchObject({ organizationId: "org-1", teamId: "T1", teamName: "Acme", botUserId: "B1" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/settings/integrations");
  });
});

describe("GET /api/integrations/github/callback — happy path", () => {
  beforeEach(() => {
    vi.resetModules();
    db.integrationUpsert.mockReset();
    db.integrationUpdateMany.mockReset();
    oauthState.validateOAuthState.mockReset();
    oauthState.validateOAuthState.mockReturnValue({ ok: true, state: { organizationId: "org-1", userId: "user-1", repo: "acme/widgets" } });
    db.integrationUpsert.mockResolvedValue({});
    githubMock.verifyRepositoryAccess.mockReset();
    githubMock.verifyRepositoryAccess.mockResolvedValue(undefined);
    auth.session = sessionFor("org-1");
    process.env.NEXTAUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  });

  it("verifies repository access before upserting, and stores owner/repo alongside the token", async () => {
    const { GET } = await import("../src/app/api/integrations/github/callback/route");
    const response = await GET(callbackRequest("github_oauth_state", { repo: "acme/widgets" }));

    expect(githubMock.verifyRepositoryAccess).toHaveBeenCalledWith("acme", "widgets");
    expect(db.integrationUpsert).toHaveBeenCalledTimes(1);
    const call = db.integrationUpsert.mock.calls[0]![0];
    expect(call.create.credentials).toMatchObject({ owner: "acme", repo: "widgets" });
    expect(response.status).toBe(307);
  });

  it("rejects with 400 and never upserts when the GitHub App can't read the repository", async () => {
    // The route's own `instanceof GithubPermissionDeniedError` check needs
    // the exact mocked class reference, not a lookalike error.
    const { GithubPermissionDeniedError } = await import("@sla/github");
    githubMock.verifyRepositoryAccess.mockRejectedValue(new GithubPermissionDeniedError(403));

    const { GET } = await import("../src/app/api/integrations/github/callback/route");
    const response = await GET(callbackRequest("github_oauth_state", { repo: "acme/widgets" }));

    expect(response.status).toBe(400);
    expect(db.integrationUpsert).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the state's repo isn't a valid owner/repo shape", async () => {
    oauthState.validateOAuthState.mockReturnValue({ ok: true, state: { organizationId: "org-1", userId: "user-1", repo: "not-a-valid-repo" } });

    const { GET } = await import("../src/app/api/integrations/github/callback/route");
    const response = await GET(callbackRequest("github_oauth_state", { repo: "not-a-valid-repo" }));

    expect(response.status).toBe(400);
    expect(db.integrationUpsert).not.toHaveBeenCalled();
  });
});
