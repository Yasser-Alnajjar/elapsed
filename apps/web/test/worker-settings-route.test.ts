/**
 * `/api/settings/worker` (Step 0.2, S-1): only a platform operator
 * (an email listed in `PLATFORM_ADMIN_EMAILS`, checked server-side — not a
 * `UserRole`) may read or change worker settings. A signed-in org owner who is not
 * a platform operator must get `403` on both GET and POST, and neither the read nor
 * the write path may be reached for them.
 *
 * Fully mocked (`@sla/db`, `next-auth`, `@/lib/auth`) — no Postgres needed,
 * since the operator check runs before anything touches the database.
 */
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const db = vi.hoisted(() => ({ saveWorkerSettings: vi.fn(), getWorkerSettingsForRead: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
// The real options module pulls in bcrypt and the credentials provider;
// the route only passes it through to the mocked getServerSession.
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", () => ({
  getPrismaClient: vi.fn(),
  saveWorkerSettings: db.saveWorkerSettings,
  getWorkerSettingsForRead: db.getWorkerSettingsForRead,
  deriveWorkerStatus: vi.fn(() => "running"),
  getWorkStateNextRuns: vi.fn(async () => ({ nextActivePollAt: null, nextReconciliationAt: null })),
  WorkerSettingsValidationError: class WorkerSettingsValidationError extends Error {},
}));

function sessionFor(email: string, role: "owner" | "member"): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: {
      id: "user-1",
      organizationId: "org-1",
      email,
      emailVerifiedAt: new Date(),
      name: null,
      image: null,
      role,
      createdAt: new Date(),
    },
  };
}

function postRequest() {
  return new Request("http://localhost/api/settings/worker", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ activePollIntervalMs: 300_000, reconciliationIntervalMs: 1_800_000 }),
  });
}

describe("POST /api/settings/worker", () => {
  const originalEnv = process.env.PLATFORM_ADMIN_EMAILS;

  beforeEach(() => {
    vi.resetModules();
    db.saveWorkerSettings.mockReset();
    auth.session = null;
  });

  afterEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = originalEnv;
  });

  it("rejects a non-operator org owner with 403 and never writes", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@watchtower.test";
    auth.session = sessionFor("owner@tenant.test", "owner");

    const { POST } = await import("../src/app/api/settings/worker/route");
    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    expect(db.saveWorkerSettings).not.toHaveBeenCalled();
  });

  it("rejects a signed-out request with 401", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@watchtower.test";
    auth.session = null;

    const { POST } = await import("../src/app/api/settings/worker/route");
    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    expect(db.saveWorkerSettings).not.toHaveBeenCalled();
  });

  it("allows a platform operator, matched case-insensitively", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Ops@Watchtower.test";
    auth.session = sessionFor("ops@watchtower.test", "member");
    db.saveWorkerSettings.mockResolvedValue({
      activePollIntervalMs: 300_000,
      reconciliationIntervalMs: 1_800_000,
      lastActivePollAt: null,
      nextActivePollAt: null,
      lastReconciliationAt: null,
      nextReconciliationAt: null,
    });

    const { POST } = await import("../src/app/api/settings/worker/route");
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(db.saveWorkerSettings).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/settings/worker", () => {
  const originalEnv = process.env.PLATFORM_ADMIN_EMAILS;

  beforeEach(() => {
    vi.resetModules();
    db.getWorkerSettingsForRead.mockReset();
    auth.session = null;
  });

  afterEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = originalEnv;
  });

  it("rejects a signed-out request with 401 and never reads", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@watchtower.test";

    const { GET } = await import("../src/app/api/settings/worker/route");
    const response = await GET();

    expect(response.status).toBe(401);
    expect(db.getWorkerSettingsForRead).not.toHaveBeenCalled();
  });

  it("rejects a non-operator org owner with 403 and never reads", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@watchtower.test";
    auth.session = sessionFor("owner@tenant.test", "owner");

    const { GET } = await import("../src/app/api/settings/worker/route");
    const response = await GET();

    expect(response.status).toBe(403);
    expect(db.getWorkerSettingsForRead).not.toHaveBeenCalled();
  });

  it("returns the diagnostics to a platform operator", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@watchtower.test";
    auth.session = sessionFor("ops@watchtower.test", "member");
    db.getWorkerSettingsForRead.mockResolvedValue({
      activePollIntervalMs: 300_000,
      reconciliationIntervalMs: 1_800_000,
      lastActivePollAt: null,
      nextActivePollAt: null,
      lastReconciliationAt: null,
      nextReconciliationAt: null,
    });

    const { GET } = await import("../src/app/api/settings/worker/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ activePollIntervalMs: 300_000, canEdit: true });
  });
});
