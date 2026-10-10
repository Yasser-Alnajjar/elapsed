/**
 * D33 / N10: the platform availability decision is one pure function, applied
 * the same way to every provider, every state and every organization; a
 * provider with no persisted row falls back to the catalog default, which is
 * the state the N10 migration seeds. No database.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_PROVIDERS,
  INTEGRATION_CATALOG,
  IntegrationUnavailableError,
  assertIntegrationAvailable,
  decideAvailability,
  defaultAvailabilityPolicy,
  resolveIntegrationAvailability,
  resolveOrganizationAvailability,
  unavailableMessage,
  type AvailabilityDb,
  type IntegrationAvailabilityPolicy,
} from "../src/index";

const policy = (overrides: Partial<IntegrationAvailabilityPolicy> = {}): IntegrationAvailabilityPolicy => ({
  ...defaultAvailabilityPolicy("intercom"),
  ...overrides,
});

describe("decideAvailability (plan 10 §4.1)", () => {
  it.each([
    { name: "disabled overrides every stage", p: { enabled: false, releaseStage: "stable" as const }, onList: true, code: "integration_disabled" },
    { name: "disabled Beta for all", p: { enabled: false, releaseStage: "beta" as const, betaAccess: "all_organizations" as const }, onList: true, code: "integration_disabled" },
    { name: "Coming Soon refuses everyone, even listed", p: { releaseStage: "coming_soon" as const }, onList: true, code: "integration_coming_soon" },
    { name: "Beta allowlist refuses an unlisted organization", p: { releaseStage: "beta" as const, betaAccess: "allowlist" as const }, onList: false, code: "integration_beta_restricted" },
  ])("$name", ({ p, onList, code }) => {
    expect(decideAvailability(policy(p), onList)).toMatchObject({ available: false, code });
  });

  it.each([
    { name: "Stable is open to everyone", p: { releaseStage: "stable" as const, betaAccess: "allowlist" as const }, onList: false },
    { name: "Beta for all organizations is open to everyone", p: { releaseStage: "beta" as const, betaAccess: "all_organizations" as const }, onList: false },
    { name: "Beta allowlist admits a listed organization", p: { releaseStage: "beta" as const, betaAccess: "allowlist" as const }, onList: true },
  ])("$name", ({ p, onList }) => {
    expect(decideAvailability(policy(p), onList)).toMatchObject({ available: true });
  });

  it("carries the operator's customer-facing note and a fixed message that names only the provider", () => {
    const decision = decideAvailability(policy({ enabled: false, statusMessage: "Back at 14:00 UTC." }), false);
    expect(decision).toEqual({
      available: false,
      provider: "intercom",
      releaseStage: "beta",
      code: "integration_disabled",
      message: "Intercom is temporarily unavailable. Your existing data is kept.",
      statusMessage: "Back at 14:00 UTC.",
    });
  });

  it("has a message for every provider and code", () => {
    for (const provider of CATALOG_PROVIDERS) {
      for (const code of ["integration_disabled", "integration_coming_soon", "integration_beta_restricted"] as const) {
        expect(unavailableMessage(provider, code)).toContain(INTEGRATION_CATALOG[provider].name);
      }
    }
  });
});

describe("catalog defaults (D33 rulings 1 and 3; the N10 migration seeds the same)", () => {
  it("covers every provider exactly once", () => {
    expect([...CATALOG_PROVIDERS].sort()).toEqual(["custom", "github", "intercom", "jira", "linear", "zendesk"]);
  });

  it("seeds Zendesk, Jira and Linear Stable; Intercom and GitHub Beta for all; Custom REST Beta allowlist with the N9.14-F1 block", () => {
    const stage = Object.fromEntries(CATALOG_PROVIDERS.map((p) => [p, defaultAvailabilityPolicy(p)]));
    for (const p of ["zendesk", "jira", "linear"] as const) expect(stage[p]).toMatchObject({ enabled: true, releaseStage: "stable" });
    for (const p of ["intercom", "github"] as const) expect(stage[p]).toMatchObject({ enabled: true, releaseStage: "beta", betaAccess: "all_organizations" });
    expect(stage.custom).toMatchObject({ enabled: true, releaseStage: "beta", betaAccess: "allowlist" });
    expect(INTEGRATION_CATALOG.custom.rolloutBlock.id).toBe("N9.14-F1");
    for (const p of CATALOG_PROVIDERS.filter((p) => p !== "custom")) expect("rolloutBlock" in INTEGRATION_CATALOG[p]).toBe(false);
  });
});

/** A fake with only the two delegates the resolver may use. */
function fakeDb(rows: Partial<IntegrationAvailabilityPolicy & { updatedAt: Date }>[], allowlist: { provider: string; organizationId: string }[]) {
  const db = {
    integrationAvailability: {
      findUnique: vi.fn(async ({ where }: { where: { provider: string } }) => {
        const row = rows.find((r) => r.provider === where.provider);
        return row ? { ...defaultAvailabilityPolicy(row.provider!), updatedAt: new Date(0), ...row } : null;
      }),
      findMany: vi.fn(async () => rows.map((row) => ({ ...defaultAvailabilityPolicy(row.provider!), updatedAt: new Date(0), ...row }))),
    },
    integrationBetaAllowlist: {
      findUnique: vi.fn(async ({ where }: { where: { provider_organizationId: { provider: string; organizationId: string } } }) =>
        allowlist.find((r) => r.provider === where.provider_organizationId.provider && r.organizationId === where.provider_organizationId.organizationId) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { organizationId: string } }) => allowlist.filter((r) => r.organizationId === where.organizationId)),
    },
  };
  return db as typeof db & AvailabilityDb;
}

describe("resolving against stored policy", () => {
  it("uses the catalog default when a provider has no row yet", async () => {
    const db = fakeDb([], []);
    expect(await resolveIntegrationAvailability(db, "org_a", "zendesk")).toMatchObject({ available: true, releaseStage: "stable" });
    expect(await resolveIntegrationAvailability(db, "org_a", "custom")).toMatchObject({ available: false, code: "integration_beta_restricted" });
  });

  it("reads the allowlist only when the policy needs it", async () => {
    const db = fakeDb([{ provider: "zendesk", enabled: false }], []);
    await resolveIntegrationAvailability(db, "org_a", "zendesk");
    expect(db.integrationBetaAllowlist.findUnique).not.toHaveBeenCalled();
  });

  it("enforces a Beta allowlist per organization", async () => {
    const db = fakeDb([], [{ provider: "custom", organizationId: "org_listed" }]);
    expect(await resolveIntegrationAvailability(db, "org_listed", "custom")).toMatchObject({ available: true });
    expect(await resolveIntegrationAvailability(db, "org_other", "custom")).toMatchObject({ available: false, code: "integration_beta_restricted" });
  });

  it("resolves every provider for one organization in two queries", async () => {
    const db = fakeDb([{ provider: "jira", enabled: false }, { provider: "github", releaseStage: "coming_soon" }], [{ provider: "custom", organizationId: "org_a" }]);
    const all = await resolveOrganizationAvailability(db, "org_a");
    expect(Object.keys(all).sort()).toEqual([...CATALOG_PROVIDERS].sort());
    expect(all.zendesk.available).toBe(true);
    expect(all.jira).toMatchObject({ available: false, code: "integration_disabled" });
    expect(all.github).toMatchObject({ available: false, code: "integration_coming_soon" });
    expect(all.custom.available).toBe(true);
    expect(db.integrationAvailability.findMany).toHaveBeenCalledTimes(1);
    expect(db.integrationBetaAllowlist.findMany).toHaveBeenCalledTimes(1);
  });

  it("assertIntegrationAvailable throws a typed error with the code", async () => {
    const db = fakeDb([{ provider: "linear", enabled: false }], []);
    await expect(assertIntegrationAvailable(db, "org_a", "linear")).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(assertIntegrationAvailable(db, "org_a", "linear")).rejects.toMatchObject({ provider: "linear", code: "integration_disabled" });
    await expect(assertIntegrationAvailable(db, "org_a", "zendesk")).resolves.toBeUndefined();
  });
});
