/**
 * `POST /api/integrations/slack/disconnect` (roadmap task 2.3): lets a
 * signed-in user disconnect Slack. Unlike Zendesk/Jira/Linear/Intercom/
 * GitHub (soft-disconnect, to protect their RawEvent replay log),
 * `SlackIntegration` has no ingestion dependency, so this route hard-deletes
 * the row.
 *
 * Fully mocked (`@sla/db`, `next-auth`, `@/lib/auth`) — no Postgres needed,
 * mirroring `worker-settings-route.test.ts`'s Pattern A shape.
 */
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", () => ({
  getPrismaClient: vi.fn(() => ({
    slackIntegration: {
      findUnique: db.findUnique,
      delete: db.delete,
    },
  })),
}));

function sessionFor(organizationId: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: {
      id: "user-1",
      organizationId,
      email: "owner@tenant.test",
      emailVerifiedAt: new Date(),
      name: null,
      image: null,
      role: "owner",
      createdAt: new Date(),
    },
  };
}

describe("POST /api/integrations/slack/disconnect", () => {
  beforeEach(() => {
    vi.resetModules();
    db.findUnique.mockReset();
    db.delete.mockReset();
    auth.session = null;
  });

  it("rejects a signed-out request with 401 and never touches the database", async () => {
    const { POST } = await import("../src/app/api/integrations/slack/disconnect/route");
    const response = await POST();

    expect(response.status).toBe(401);
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("returns 404 when Slack isn't connected, without attempting a delete", async () => {
    auth.session = sessionFor("org-1");
    db.findUnique.mockResolvedValue(null);

    const { POST } = await import("../src/app/api/integrations/slack/disconnect/route");
    const response = await POST();

    expect(response.status).toBe(404);
    expect(db.findUnique).toHaveBeenCalledWith({ where: { organizationId: "org-1" } });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("hard-deletes the SlackIntegration row for the signed-in user's organization", async () => {
    auth.session = sessionFor("org-1");
    db.findUnique.mockResolvedValue({ id: "slack-1", organizationId: "org-1" });
    db.delete.mockResolvedValue({ id: "slack-1" });

    const { POST } = await import("../src/app/api/integrations/slack/disconnect/route");
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "disconnected" });
    expect(db.delete).toHaveBeenCalledWith({ where: { organizationId: "org-1" } });
  });

  it("only ever deletes the signed-in user's own organization's row, never one from the request", async () => {
    auth.session = sessionFor("org-a");
    db.findUnique.mockResolvedValue({ id: "slack-a", organizationId: "org-a" });
    db.delete.mockResolvedValue({ id: "slack-a" });

    const { POST } = await import("../src/app/api/integrations/slack/disconnect/route");
    await POST();

    expect(db.findUnique).toHaveBeenCalledWith({ where: { organizationId: "org-a" } });
    expect(db.delete).toHaveBeenCalledWith({ where: { organizationId: "org-a" } });
  });
});
