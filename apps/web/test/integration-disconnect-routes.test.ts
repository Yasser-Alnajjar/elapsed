/**
 * `POST /api/integrations/{provider}/disconnect` for the five providers that
 * soft-disconnect (Zendesk, Jira, Linear, Intercom, GitHub) — all five route
 * files are structurally identical (clear credentials, mark disconnected,
 * never delete the row, since RawEvent.integrationId cascades on delete and
 * would destroy the immutable replay log). Slack's disconnect is hard-delete
 * instead (see slack-disconnect-route.test.ts) and tested separately.
 *
 * Fully mocked (`@sla/db`, `next-auth`, `@/lib/auth`) — no Postgres needed,
 * mirroring `worker-settings-route.test.ts`'s Pattern A shape.
 */
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", () => ({
  getPrismaClient: vi.fn(() => ({
    integration: {
      findUnique: db.findUnique,
      update: db.update,
    },
  })),
  Prisma: { JsonNull: Symbol("Prisma.JsonNull") },
}));

function sessionFor(organizationId: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email: "owner@tenant.test", emailVerifiedAt: new Date(), name: null, image: null, role: "owner", createdAt: new Date() },
  };
}

const PROVIDERS = [
  { provider: "zendesk", label: "Zendesk" },
  { provider: "jira", label: "Jira" },
  { provider: "linear", label: "Linear" },
  { provider: "intercom", label: "Intercom" },
  { provider: "github", label: "GitHub" },
] as const;

describe.each(PROVIDERS)("POST /api/integrations/$provider/disconnect", ({ provider, label }) => {
  beforeEach(() => {
    vi.resetModules();
    db.findUnique.mockReset();
    db.update.mockReset();
    auth.session = null;
  });

  it("rejects a signed-out request with 401 and never touches the database", async () => {
    const { POST } = await import(`../src/app/api/integrations/${provider}/disconnect/route`);
    const response = await POST();

    expect(response.status).toBe(401);
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it(`returns 404 when ${label} isn't connected, without attempting an update`, async () => {
    auth.session = sessionFor("org-1");
    db.findUnique.mockResolvedValue(null);

    const { POST } = await import(`../src/app/api/integrations/${provider}/disconnect/route`);
    const response = await POST();

    expect(response.status).toBe(404);
    expect(db.findUnique).toHaveBeenCalledWith({
      where: { organizationId_provider: { organizationId: "org-1", provider } },
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("soft-disconnects: clears credentials and marks the row disconnected, never deletes it", async () => {
    auth.session = sessionFor("org-1");
    db.findUnique.mockResolvedValue({ id: "int-1", organizationId: "org-1", provider });
    db.update.mockResolvedValue({});

    const { POST } = await import(`../src/app/api/integrations/${provider}/disconnect/route`);
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "disconnected" });
    expect(db.update).toHaveBeenCalledTimes(1);
    const call = db.update.mock.calls[0]![0];
    expect(call.where).toEqual({ id: "int-1" });
    expect(call.data).toMatchObject({ status: "disconnected" });
    expect(call.data.disconnectedAt).toBeInstanceOf(Date);
  });

  it("only ever disconnects the signed-in user's own organization's integration", async () => {
    auth.session = sessionFor("org-a");
    db.findUnique.mockResolvedValue({ id: "int-a", organizationId: "org-a", provider });
    db.update.mockResolvedValue({});

    const { POST } = await import(`../src/app/api/integrations/${provider}/disconnect/route`);
    await POST();

    expect(db.findUnique).toHaveBeenCalledWith({
      where: { organizationId_provider: { organizationId: "org-a", provider } },
    });
  });
});
