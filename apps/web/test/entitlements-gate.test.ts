/**
 * The creation-point gate (N6.3, N6.4): what the routes do with an entitlement
 * decision. The decision logic itself is covered in `packages/db/test/entitlements.test.ts`.
 */
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  decision: { outcome: "allow" } as Record<string, unknown>,
  integration: null as { status: string } | null,
  checked: [] as string[],
  session: null as Session | null,
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@sla/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sla/db")>()),
  getPrismaClient: vi.fn(() => ({ integration: { findUnique: async () => state.integration } })),
  checkEntitlement: vi.fn(async (_prisma: unknown, _org: string, resource: string) => {
    state.checked.push(resource);
    return state.decision;
  }),
}));

const owner = (): Session => ({
  expires: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: "u1", organizationId: "org-a", email: "o@x.test", emailVerifiedAt: new Date(), name: null, image: null, role: "owner", createdAt: new Date() },
});

beforeEach(() => {
  vi.resetModules();
  state.decision = { outcome: "allow" };
  state.integration = null;
  state.checked = [];
  state.session = owner();
});

describe("gateCreation", () => {
  it("proceeds without a warning when allowed", async () => {
    const { gateCreation } = await import("../src/lib/entitlements");
    expect(await gateCreation("org-a", "seats")).toEqual({ proceed: true, warning: null });
  });

  it("proceeds with a warning that names the usage and an upgrade path when over a limit", async () => {
    state.decision = { outcome: "warn", resource: "seats", used: 5, limit: 5 };
    const { gateCreation } = await import("../src/lib/entitlements");
    const gate = await gateCreation("org-a", "seats");
    expect(gate).toMatchObject({ proceed: true, warning: { resource: "seats", upgradeUrl: "/pricing" } });
    expect(gate.proceed && gate.warning?.message).toContain("5 of 5 seats");
  });

  it("stops with 402 and says monitoring continues once the trial has ended", async () => {
    state.decision = { outcome: "blocked", reason: "trial_expired", trialEndedAt: new Date() };
    const { gateCreation } = await import("../src/lib/entitlements");
    const gate = await gateCreation("org-a", "nativePolicies");
    expect(gate.proceed).toBe(false);
    if (gate.proceed) return;
    expect(gate.response.status).toBe(402);
    const body = await gate.response.json();
    expect(body).toMatchObject({ code: "trial_expired", upgradeUrl: "/pricing" });
    expect(body.error).toContain("monitoring");
  });
});

describe("gateIntegrationConnect", () => {
  it("counts a new Zendesk connection against support integrations and a Jira one against engineering", async () => {
    const { gateIntegrationConnect } = await import("../src/lib/entitlements");
    await gateIntegrationConnect("org-a", "zendesk");
    await gateIntegrationConnect("org-a", "jira");
    expect(state.checked).toEqual(["ticketSourceIntegrations", "engineeringIntegrations"]);
  });

  it("takes no new slot for a reconnect of a provider the organization already has", async () => {
    state.integration = { status: "reauth_required" };
    state.decision = { outcome: "blocked", reason: "trial_expired", trialEndedAt: new Date() };
    const { gateIntegrationConnect } = await import("../src/lib/entitlements");
    expect(await gateIntegrationConnect("org-a", "jira")).toEqual({ proceed: true, warning: null });
    expect(state.checked).toEqual([]);
  });

  it("does treat a previously disconnected provider as a new connection", async () => {
    state.integration = { status: "disconnected" };
    const { gateIntegrationConnect } = await import("../src/lib/entitlements");
    await gateIntegrationConnect("org-a", "jira");
    expect(state.checked).toEqual(["engineeringIntegrations"]);
  });
});

describe("connect routes", () => {
  it("send a browser with a lapsed trial back to the integrations page instead of the provider", async () => {
    state.decision = { outcome: "blocked", reason: "trial_expired", trialEndedAt: new Date() };
    const { GET } = await import("../src/app/api/integrations/jira/connect/route");
    const response = await GET(new Request("http://localhost/api/integrations/jira/connect"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/settings/integrations?entitlement=trial_expired");
  });
});
