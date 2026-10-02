import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import {
  checkEntitlement,
  evaluateCreation,
  getEntitlementNotice,
  integrationResource,
  isTrialExpired,
  markTrialExpiry,
  settleTrialExpiryNotice,
  type PlanSubject,
} from "../src/entitlements";
import { getOrganizationUsage, type OrganizationUsage, type ProviderRoleOf } from "../src/usage";

const NOW = new Date("2026-10-10T12:00:00Z");
const roleOf: ProviderRoleOf = (provider) => (provider === "zendesk" || provider === "intercom" ? "ticket_source" : provider === "github" ? "code_host" : "work_tracker");
const none: OrganizationUsage = { seats: 0, ticketSourceIntegrations: 0, engineeringIntegrations: 0, nativePolicies: 0 };
const subject = (overrides: Partial<PlanSubject> = {}): PlanSubject => ({ plan: "starter", planStatus: "active", trialEndsAt: null, ...overrides });

describe("evaluateCreation", () => {
  it("allows while under the limit and warns at it, never blocks over a limit", () => {
    expect(evaluateCreation(subject(), { ...none, seats: 4 }, "seats", NOW)).toEqual({ outcome: "allow" });
    expect(evaluateCreation(subject(), { ...none, seats: 5 }, "seats", NOW)).toEqual({ outcome: "warn", resource: "seats", used: 5, limit: 5 });
    expect(evaluateCreation(subject(), { ...none, seats: 50 }, "seats", NOW).outcome).toBe("warn");
  });

  it("treats a null limit as unlimited", () => {
    expect(evaluateCreation(subject({ plan: "team" }), { ...none, nativePolicies: 500 }, "nativePolicies", NOW)).toEqual({ outcome: "allow" });
    expect(evaluateCreation(subject({ plan: "enterprise" }), { ...none, seats: 500 }, "seats", NOW)).toEqual({ outcome: "allow" });
  });

  it("allows with no recorded plan, an unknown plan, or an internal tenant", () => {
    const full = { ...none, seats: 99 };
    expect(evaluateCreation(subject({ plan: null }), full, "seats", NOW).outcome).toBe("allow");
    expect(evaluateCreation(subject({ plan: "growth" }), full, "seats", NOW).outcome).toBe("allow");
    expect(evaluateCreation(subject({ planStatus: "internal" }), full, "seats", NOW).outcome).toBe("allow");
  });

  it("gives a running trial full access, whatever the plan limits say", () => {
    const trial = subject({ planStatus: "trial", trialEndsAt: new Date("2026-10-20T00:00:00Z") });
    expect(evaluateCreation(trial, { ...none, seats: 99 }, "seats", NOW)).toEqual({ outcome: "allow" });
  });

  it("blocks new configuration once the trial has ended (D27)", () => {
    const lapsed = subject({ planStatus: "trial", plan: null, trialEndsAt: new Date("2026-10-09T00:00:00Z") });
    expect(isTrialExpired(lapsed, NOW)).toBe(true);
    expect(evaluateCreation(lapsed, none, "seats", NOW)).toEqual({ outcome: "blocked", reason: "trial_expired", trialEndedAt: lapsed.trialEndsAt });
  });

  it("a trial with no end date never lapses, and only a trial can lapse", () => {
    expect(isTrialExpired(subject({ planStatus: "trial", trialEndsAt: null }), NOW)).toBe(false);
    expect(isTrialExpired(subject({ planStatus: "active", trialEndsAt: new Date("2020-01-01") }), NOW)).toBe(false);
  });

  it("counts a work tracker and a code host as engineering integrations, a ticket source as support", () => {
    expect(integrationResource("zendesk", roleOf)).toBe("ticketSourceIntegrations");
    expect(integrationResource("jira", roleOf)).toBe("engineeringIntegrations");
    expect(integrationResource("github", roleOf)).toBe("engineeringIntegrations");
  });
});

interface FakeState {
  enforced: boolean;
  organization: { plan: string | null; planStatus: PlanSubject["planStatus"]; trialEndsAt: Date | null } | null;
  users: { role: "owner" | "member"; email: string }[];
  pendingInvitations: number;
  integrations: { provider: string; status: string }[];
  policies: { source: string; archivedAt: Date | null }[];
  events: Record<string, unknown>[];
  queries: string[];
  whereSeen: Record<string, unknown>;
}

function fake(state: Partial<FakeState> = {}) {
  const s: FakeState = {
    enforced: true,
    organization: { plan: "starter", planStatus: "active", trialEndsAt: null },
    users: [],
    pendingInvitations: 0,
    integrations: [],
    policies: [],
    events: [],
    queries: [],
    whereSeen: {},
    ...state,
  };
  const prisma = {
    workerSettings: { findUnique: async () => (s.queries.push("settings"), { entitlementsEnforced: s.enforced }) },
    organization: { findUnique: async () => (s.queries.push("organization"), s.organization) },
    user: {
      count: async () => (s.queries.push("users"), s.users.length),
      findMany: async ({ where }: { where: { role?: string } }) => s.users.filter((u) => !where.role || u.role === where.role).map((u) => ({ email: u.email })),
    },
    organizationInvitation: {
      count: async ({ where }: { where: Record<string, unknown> }) => ((s.whereSeen.invitations = where), s.pendingInvitations),
    },
    integration: {
      findMany: async ({ where }: { where: { status: { not: string } } }) => (
        (s.whereSeen.integrations = where), s.integrations.filter((i) => i.status !== where.status.not).map((i) => ({ provider: i.provider }))
      ),
    },
    sLAPolicy: {
      count: async ({ where }: { where: { source: string; archivedAt: null } }) => (
        (s.whereSeen.policies = where), s.policies.filter((p) => p.source === where.source && p.archivedAt === where.archivedAt).length
      ),
    },
    entitlementEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (s.events.some((e) => e.organizationId === data.organizationId && e.kind === data.kind && e.dedupeKey === data.dedupeKey)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        s.events.push({ ...data });
        return data;
      },
      update: async ({ where, data }: { where: { organizationId_kind_dedupeKey: Record<string, unknown> }; data: Record<string, unknown> }) => {
        const key = where.organizationId_kind_dedupeKey;
        Object.assign(s.events.find((e) => e.organizationId === key.organizationId && e.kind === key.kind && e.dedupeKey === key.dedupeKey)!, data);
      },
      delete: async ({ where }: { where: { organizationId_kind_dedupeKey: Record<string, unknown> } }) => {
        const key = where.organizationId_kind_dedupeKey;
        s.events = s.events.filter((e) => !(e.organizationId === key.organizationId && e.kind === key.kind && e.dedupeKey === key.dedupeKey));
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, state: s };
}

describe("getOrganizationUsage (N6.2)", () => {
  it("counts members plus unexpired pending invitations as seats", async () => {
    const { prisma, state } = fake({ users: [{ role: "owner", email: "a@x" }, { role: "member", email: "b@x" }], pendingInvitations: 2 });
    expect((await getOrganizationUsage(prisma, "org-a", roleOf, NOW)).seats).toBe(4);
    expect(state.whereSeen.invitations).toEqual({ organizationId: "org-a", status: "pending", expiresAt: { gt: NOW } });
  });

  it("splits integrations by role and ignores disconnected ones", async () => {
    const { prisma } = fake({
      integrations: [
        { provider: "zendesk", status: "connected" },
        { provider: "intercom", status: "disconnected" },
        { provider: "jira", status: "reauth_required" },
        { provider: "github", status: "connected" },
      ],
    });
    const usage = await getOrganizationUsage(prisma, "org-a", roleOf, NOW);
    expect(usage.ticketSourceIntegrations).toBe(1);
    expect(usage.engineeringIntegrations).toBe(2);
  });

  it("counts native, non-archived policies only: imported ones never count (D25)", async () => {
    const { prisma, state } = fake({
      policies: [
        { source: "native", archivedAt: null },
        { source: "native", archivedAt: null },
        { source: "imported", archivedAt: null },
        { source: "imported", archivedAt: null },
        { source: "imported", archivedAt: null },
      ],
    });
    expect((await getOrganizationUsage(prisma, "org-a", roleOf, NOW)).nativePolicies).toBe(2);
    expect(state.whereSeen.policies).toEqual({ organizationId: "org-a", source: "native", archivedAt: null });
  });

  it("scopes every count to the one organization", async () => {
    const { prisma, state } = fake();
    await getOrganizationUsage(prisma, "org-a", roleOf, NOW);
    expect(state.whereSeen.integrations).toMatchObject({ organizationId: "org-a" });
  });
});

describe("checkEntitlement (N6.3)", () => {
  it("does one settings read and nothing else while enforcement is off", async () => {
    const { prisma, state } = fake({ enforced: false, organization: { plan: "starter", planStatus: "trial", trialEndsAt: new Date("2020-01-01") } });
    expect(await checkEntitlement(prisma, "org-a", "seats", { roleOf, now: NOW })).toEqual({ outcome: "allow" });
    expect(state.queries).toEqual(["settings"]);
    expect(state.events).toEqual([]);
  });

  it("warns, records one event per resource and day, and does not duplicate it", async () => {
    const { prisma, state } = fake({ users: Array.from({ length: 5 }, (_, i) => ({ role: "member" as const, email: `${i}@x` })) });
    const first = await checkEntitlement(prisma, "org-a", "seats", { roleOf, now: NOW });
    const second = await checkEntitlement(prisma, "org-a", "seats", { roleOf, now: NOW });
    expect(first).toEqual({ outcome: "warn", resource: "seats", used: 5, limit: 5 });
    expect(second.outcome).toBe("warn");
    expect(state.events).toEqual([
      { organizationId: "org-a", kind: "limit_warned", resource: "seats", dedupeKey: "seats:2026-10-10", used: 5, limit: 5 },
    ]);
  });

  it("a tenant over every limit is warned at each creation point and never blocked", async () => {
    const { prisma } = fake({
      users: Array.from({ length: 9 }, (_, i) => ({ role: "member" as const, email: `${i}@x` })),
      integrations: [{ provider: "zendesk", status: "connected" }, { provider: "intercom", status: "connected" }, { provider: "jira", status: "connected" }, { provider: "linear", status: "connected" }],
      policies: Array.from({ length: 6 }, () => ({ source: "native", archivedAt: null })),
    });
    for (const resource of ["seats", "ticketSourceIntegrations", "engineeringIntegrations", "nativePolicies"] as const) {
      expect((await checkEntitlement(prisma, "org-a", resource, { roleOf, now: NOW })).outcome).toBe("warn");
    }
  });

  it("blocks and records when the trial has ended", async () => {
    const { prisma, state } = fake({ organization: { plan: null, planStatus: "trial", trialEndsAt: new Date("2026-10-01T00:00:00Z") } });
    const decision = await checkEntitlement(prisma, "org-a", "nativePolicies", { roleOf, now: NOW });
    expect(decision.outcome).toBe("blocked");
    expect(state.events).toMatchObject([{ kind: "creation_blocked", resource: "nativePolicies" }]);
  });

  it("does not break the creation point when recording fails", async () => {
    const { prisma } = fake({ users: Array.from({ length: 5 }, (_, i) => ({ role: "member" as const, email: `${i}@x` })) });
    (prisma as unknown as { entitlementEvent: { create: () => Promise<never> } }).entitlementEvent.create = async () => {
      throw new Error("db down");
    };
    expect((await checkEntitlement(prisma, "org-a", "seats", { roleOf, now: NOW })).outcome).toBe("warn");
  });
});

describe("getEntitlementNotice", () => {
  it("is empty while enforcement is off", async () => {
    const { prisma } = fake({ enforced: false });
    expect(await getEntitlementNotice(prisma, "org-a", { roleOf, now: NOW })).toEqual({ trialExpired: null, overLimit: [] });
  });

  it("reports a lapsed trial, and over-limit resources only once genuinely over", async () => {
    const lapsed = fake({ organization: { plan: null, planStatus: "trial", trialEndsAt: new Date("2026-10-01T00:00:00Z") } });
    expect((await getEntitlementNotice(lapsed.prisma, "org-a", { roleOf, now: NOW })).trialExpired).toMatchObject({ state: "trial_expired" });

    const atLimit = fake({ users: Array.from({ length: 5 }, (_, i) => ({ role: "member" as const, email: `${i}@x` })) });
    expect((await getEntitlementNotice(atLimit.prisma, "org-a", { roleOf, now: NOW })).overLimit).toEqual([]);

    const over = fake({ users: Array.from({ length: 6 }, (_, i) => ({ role: "member" as const, email: `${i}@x` })) });
    expect((await getEntitlementNotice(over.prisma, "org-a", { roleOf, now: NOW })).overLimit).toEqual([{ resource: "seats", used: 6, limit: 5 }]);
  });
});

describe("markTrialExpiry (N6.4)", () => {
  const lapsed = { plan: null, planStatus: "trial" as const, trialEndsAt: new Date("2026-10-01T00:00:00Z") };

  it("does nothing for a trial that has not ended", async () => {
    const { prisma, state } = fake({ organization: { ...lapsed, trialEndsAt: new Date("2026-11-01T00:00:00Z") } });
    expect((await markTrialExpiry(prisma, "org-a", NOW)).outcome).toBe("not_expired");
    expect(state.events).toEqual([]);
  });

  it("claims once, returns the owners to email, and is idempotent across ticks", async () => {
    const { prisma, state } = fake({
      organization: lapsed,
      users: [{ role: "owner", email: "owner@x.com" }, { role: "member", email: "m@x.com" }],
    });
    const first = await markTrialExpiry(prisma, "org-a", NOW);
    expect(first).toMatchObject({ outcome: "marked", ownerEmails: ["owner@x.com"] });
    const later = await markTrialExpiry(prisma, "org-a", new Date("2026-10-11T12:00:00Z"));
    expect(later.outcome).toBe("already_handled");
    expect(later.ownerEmails).toEqual([]);
    expect(state.events).toHaveLength(1);
  });

  it("a sent notice is stamped, a failed one releases the claim so the next tick retries", async () => {
    const { prisma, state } = fake({ organization: lapsed, users: [{ role: "owner", email: "owner@x.com" }] });
    const claim = await markTrialExpiry(prisma, "org-a", NOW);
    await settleTrialExpiryNotice(prisma, "org-a", claim.trialEndedAt!, "failed", NOW);
    expect(state.events).toEqual([]);
    expect((await markTrialExpiry(prisma, "org-a", NOW)).outcome).toBe("marked");
    await settleTrialExpiryNotice(prisma, "org-a", claim.trialEndedAt!, "sent", NOW);
    expect(state.events[0]).toMatchObject({ notifiedAt: NOW });
    expect((await markTrialExpiry(prisma, "org-a", NOW)).outcome).toBe("already_handled");
  });
});
