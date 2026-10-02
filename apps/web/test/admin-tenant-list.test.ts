import { describe, expect, it } from "vitest";
import { countByHealth, DEFAULT_TENANT_CONTROLS, selectTenants } from "../src/lib/admin-tenant-list";
import { formatSpan, formatUtcShort, formatUtcTimestamp, shortId } from "../src/lib/admin-format";
import type { AdminTenantRow, TenantHealth } from "../src/lib/types/admin";

function tenant(over: Partial<AdminTenantRow> & { name: string; health: TenantHealth }): AdminTenantRow {
  return {
    organizationId: `org_${over.name.toLowerCase()}`,
    createdAt: "2026-10-02T07:14:00.000Z",
    ownerEmail: `owner@${over.name.toLowerCase()}.test`,
    memberCount: 1,
    pendingInvitations: 0,
    plan: null,
    planStatus: "trial",
    trialEndsAt: null,
    billingReference: null,
    integrations: [],
    openCases: 0,
    evaluations24h: 0,
    notificationsSent24h: 0,
    notificationsFailed24h: 0,
    linkCoverage: { cases: 0, linkedCases: 0, ratio: null },
    ...over,
  };
}

const acme = tenant({ name: "Acme", health: "healthy", plan: "team", planStatus: "active", openCases: 8, linkCoverage: { cases: 8, linkedCases: 6, ratio: 0.75 } });
const globex = tenant({ name: "Globex", health: "unhealthy", openCases: 12, linkCoverage: { cases: 12, linkedCases: 2, ratio: 2 / 12 } });
const initech = tenant({ name: "Initech", health: "healthy", plan: "starter", planStatus: "past_due", openCases: 3, linkCoverage: { cases: 3, linkedCases: 0, ratio: 0 } });
const ops = tenant({ name: "Ops HQ", health: "none" });
const ALL = [ops, acme, initech, globex];

const names = (rows: AdminTenantRow[]) => rows.map((row) => row.name);

describe("selectTenants (the Tenants list controls)", () => {
  it("defaults to worst health first, then name", () => {
    expect(names(selectTenants(ALL, DEFAULT_TENANT_CONTROLS))).toEqual(["Globex", "Acme", "Initech", "Ops HQ"]);
  });

  it("filters by health", () => {
    expect(names(selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, health: "healthy" }))).toEqual(["Acme", "Initech"]);
  });

  it("searches name, owner email and tenant id", () => {
    expect(names(selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, query: "glob" }))).toEqual(["Globex"]);
    expect(names(selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, query: "owner@acme" }))).toEqual(["Acme"]);
    expect(names(selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, query: "ORG_OPS" }))).toEqual(["Ops HQ"]);
  });

  it("filters by plan status, and 'unrecorded' means no plan set", () => {
    expect(names(selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, plan: "past_due" }))).toEqual(["Initech"]);
    expect(names(selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, plan: "unrecorded" }))).toEqual(["Globex", "Ops HQ"]);
  });

  it("sorts by open cases (most first) and by link coverage (lowest first, nothing-to-measure last)", () => {
    expect(names(selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, sort: "cases" }))[0]).toBe("Globex");
    expect(names(selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, sort: "coverage" }))).toEqual(["Initech", "Globex", "Acme", "Ops HQ"]);
  });

  it("does not reorder its input", () => {
    const before = names(ALL);
    selectTenants(ALL, { ...DEFAULT_TENANT_CONTROLS, sort: "name" });
    expect(names(ALL)).toEqual(before);
  });
});

describe("countByHealth", () => {
  it("counts every health word over the whole list", () => {
    expect(countByHealth(ALL)).toEqual({ all: 4, unhealthy: 1, attention: 0, healthy: 2, none: 1 });
  });
});

describe("admin formatting (UTC, static)", () => {
  it("renders timestamps in UTC whatever the runtime timezone", () => {
    expect(formatUtcTimestamp("2026-10-02T07:12:27.000Z")).toBe("Oct 2, 2026, 07:12:27 AM UTC");
    expect(formatUtcShort("2026-10-02T19:05:00.000Z")).toBe("Oct 2, 07:05 PM");
    expect(formatUtcTimestamp(null)).toBe("Never");
  });

  it("formats a span and shortens an id", () => {
    expect(formatSpan(36_000)).toBe("36s");
    expect(formatSpan(252_000)).toBe("4m 12s");
    expect(formatSpan(7_500_000)).toBe("2h 05m");
    expect(shortId("cmg3k9x0a0000abcd1234")).toBe("cmg3k9x0");
    expect(shortId("org_1")).toBe("org_1");
  });
});
