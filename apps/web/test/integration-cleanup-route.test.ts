/**
 * `POST /api/integrations/{provider}/cleanup` — the explicit, separate
 * "Clean up data" action (disconnect never calls it). Covers the route's own
 * gates and status mapping; what is deleted and what is kept is covered
 * against a real Postgres in integration-data-cleanup.test.ts.
 *
 * Fully mocked (`@sla/db`, `next-auth`, `@/lib/auth`) — no Postgres needed,
 * mirroring integration-config-delete-route.test.ts.
 */
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({ cleanupIntegrationData: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", () => ({
  getPrismaClient: vi.fn(() => ({})),
  cleanupIntegrationData: db.cleanupIntegrationData,
}));

function sessionFor(organizationId: string, role: "owner" | "member" = "owner"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email: "owner@tenant.test", emailVerifiedAt: new Date(), name: null, image: null, role, createdAt: new Date() },
  };
}

const COUNTS = { rawEvents: 2, normalizedEvents: 3, cases: 1, caseLinksRemoved: 0, caseLinksTrimmed: 0, customerIdentities: 1, customers: 1 };

const NO_BODY = Symbol("no body");

async function post(provider: string, body: unknown = { confirm: provider }) {
  const { POST } = await import("../src/app/api/integrations/[provider]/cleanup/route");
  return POST(new Request("http://localhost/api", { method: "POST", body: body === NO_BODY ? undefined : JSON.stringify(body) }), {
    params: Promise.resolve({ provider }),
  });
}

describe("POST /api/integrations/[provider]/cleanup", () => {
  beforeEach(() => {
    vi.resetModules();
    db.cleanupIntegrationData.mockReset();
    auth.session = null;
  });

  it("rejects a signed-out request with 401 and never cleans up", async () => {
    expect((await post("zendesk")).status).toBe(401);
    expect(db.cleanupIntegrationData).not.toHaveBeenCalled();
  });

  it("rejects a non-owner with 403", async () => {
    auth.session = sessionFor("org-1", "member");
    expect((await post("zendesk")).status).toBe(403);
    expect(db.cleanupIntegrationData).not.toHaveBeenCalled();
  });

  it("returns 404 for a provider that is not an integration (slack has none)", async () => {
    auth.session = sessionFor("org-1");
    expect((await post("slack")).status).toBe(404);
    expect((await post("bogus")).status).toBe(404);
    expect(db.cleanupIntegrationData).not.toHaveBeenCalled();
  });

  it("returns 400 unless the body names the integration being cleaned", async () => {
    auth.session = sessionFor("org-1");
    expect((await post("zendesk", {})).status).toBe(400);
    expect((await post("zendesk", { confirm: true })).status).toBe(400);
    expect((await post("zendesk", { confirm: "jira" })).status).toBe(400);
    expect((await post("zendesk", NO_BODY)).status).toBe(400);
    expect(db.cleanupIntegrationData).not.toHaveBeenCalled();
  });

  it("returns 404 when the integration has no row", async () => {
    auth.session = sessionFor("org-1");
    db.cleanupIntegrationData.mockResolvedValue({ status: "not_found" });
    expect((await post("jira")).status).toBe(404);
  });

  it("refuses with 409 while the integration is not disconnected", async () => {
    auth.session = sessionFor("org-1");
    db.cleanupIntegrationData.mockResolvedValue({ status: "not_disconnected" });
    const response = await post("zendesk");

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/disconnect/i);
  });

  it("cleans up only the signed-in organization's integration and returns the counts", async () => {
    auth.session = sessionFor("org-a");
    db.cleanupIntegrationData.mockResolvedValue({ status: "cleaned", counts: COUNTS });
    const response = await post("intercom");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "cleaned", counts: COUNTS });
    expect(db.cleanupIntegrationData).toHaveBeenCalledTimes(1);
    expect(db.cleanupIntegrationData).toHaveBeenCalledWith(expect.anything(), "org-a", "intercom", {
      userId: "user-1",
      email: "owner@tenant.test",
    });
  });
});
