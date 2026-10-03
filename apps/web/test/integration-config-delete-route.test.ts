/**
 * `DELETE /api/integrations/{provider}/config` — permanently deletes the
 * provider's OAuth app configuration (as opposed to `/disconnect`, which
 * keeps it). All six route files share `createIntegrationConfigHandlers`,
 * so each is exercised against the same mocked `deleteIntegrationConfig`;
 * that helper's own transaction is covered in @sla/db's
 * integration-config.test.ts.
 *
 * Fully mocked (`@sla/db`, `next-auth`, `@/lib/auth`) — no Postgres needed,
 * mirroring integration-disconnect-routes.test.ts.
 */
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({ deleteIntegrationConfig: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", () => ({
  getPrismaClient: vi.fn(() => ({})),
  getIntegrationConfigStatus: vi.fn(),
  saveIntegrationConfig: vi.fn(),
  deleteIntegrationConfig: db.deleteIntegrationConfig,
}));

function sessionFor(organizationId: string, role: "owner" | "member" = "owner"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email: "owner@tenant.test", emailVerifiedAt: new Date(), name: null, image: null, role, createdAt: new Date() },
  };
}

const PROVIDERS = ["zendesk", "jira", "linear", "intercom", "github", "slack"] as const;

describe.each(PROVIDERS)("DELETE /api/integrations/%s/config", (provider) => {
  beforeEach(() => {
    vi.resetModules();
    db.deleteIntegrationConfig.mockReset();
    auth.session = null;
  });

  async function load() {
    return import(`../src/app/api/integrations/${provider}/config/route`);
  }

  it("rejects a signed-out request with 401 and never touches the database", async () => {
    const { DELETE } = await load();
    const response = await DELETE();

    expect(response.status).toBe(401);
    expect(db.deleteIntegrationConfig).not.toHaveBeenCalled();
  });

  it("rejects a non-owner with 403", async () => {
    auth.session = sessionFor("org-1", "member");
    const { DELETE } = await load();
    const response = await DELETE();

    expect(response.status).toBe(403);
    expect(db.deleteIntegrationConfig).not.toHaveBeenCalled();
  });

  it("returns 404 when the provider isn't configured", async () => {
    auth.session = sessionFor("org-1");
    db.deleteIntegrationConfig.mockResolvedValue("not_configured");

    const { DELETE } = await load();
    const response = await DELETE();

    expect(response.status).toBe(404);
  });

  it("refuses with 409 while the integration is connected — disconnect comes first", async () => {
    auth.session = sessionFor("org-1");
    db.deleteIntegrationConfig.mockResolvedValue("connected");

    const { DELETE } = await load();
    const response = await DELETE();

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Disconnect/);
  });

  it("deletes only the signed-in organization's configuration and reports it unconfigured", async () => {
    auth.session = sessionFor("org-a");
    db.deleteIntegrationConfig.mockResolvedValue("deleted");

    const { DELETE } = await load();
    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false, clientId: null });
    expect(db.deleteIntegrationConfig).toHaveBeenCalledWith({}, "org-a", provider);
  });
});
