/** Pure rules behind the tenants list: one-word health, and the provider-pair label (N4.4, N4.7). No database. */
import { describe, expect, it } from "vitest";
import { deriveTenantHealth, providerPairLabel } from "../src/lib/admin-tenants-data";
import { integrationState } from "../src/components/admin/tenant-badges";
import type { AdminTenantIntegrationRow } from "../src/lib/types/admin";

type Row = Pick<AdminTenantIntegrationRow, "status" | "failingSince" | "lastSyncError" | "pollingPausedAt" | "stale">;
const ok: Row = { status: "connected", failingSince: null, lastSyncError: null, pollingPausedAt: null, stale: false };

describe("deriveTenantHealth", () => {
  it("is 'none' with no integration, or only disconnected ones: there is nothing to be healthy", () => {
    expect(deriveTenantHealth([], 0)).toBe("none");
    expect(deriveTenantHealth([{ ...ok, status: "disconnected", stale: true, failingSince: "x" }], 5)).toBe("none");
  });

  it("is healthy when everything syncs and no alert is failing", () => {
    expect(deriveTenantHealth([ok, ok], 0)).toBe("healthy");
  });

  it.each([
    ["needs reconnect", { status: "reauth_required" as const }],
    ["lost access", { status: "permission_denied" as const }],
    ["in a failing streak", { failingSince: "2026-10-02T10:00:00.000Z" }],
    ["stale with polling running", { stale: true }],
  ])("is unhealthy when an integration is %s", (_name, patch) => {
    expect(deriveTenantHealth([ok, { ...ok, ...patch }], 0)).toBe("unhealthy");
  });

  it("a paused integration is attention, not an outage, even though it is stale", () => {
    expect(deriveTenantHealth([{ ...ok, pollingPausedAt: "2026-10-02T10:00:00.000Z", stale: true }], 0)).toBe("attention");
  });

  it("failing alert delivery alone is attention", () => {
    expect(deriveTenantHealth([ok], 2)).toBe("attention");
  });

  it("unhealthy outranks attention", () => {
    expect(deriveTenantHealth([{ ...ok, pollingPausedAt: "x" }, { ...ok, status: "reauth_required" }], 3)).toBe("unhealthy");
  });

  it("a disconnected integration's problems are ignored", () => {
    expect(deriveTenantHealth([ok, { ...ok, status: "disconnected", failingSince: "x", stale: true }], 0)).toBe("healthy");
  });
});

describe("providerPairLabel", () => {
  const row = (provider: AdminTenantIntegrationRow["provider"], role: AdminTenantIntegrationRow["role"], status: AdminTenantIntegrationRow["status"] = "connected") => ({
    provider,
    role,
    status,
  });

  it("names the connected providers, ticket source first, whatever order they were connected in", () => {
    expect(providerPairLabel([row("github", "code_host"), row("jira", "work_tracker"), row("zendesk", "ticket_source")])).toBe(
      "Zendesk + Jira + GitHub",
    );
    expect(providerPairLabel([row("linear", "work_tracker"), row("intercom", "ticket_source")])).toBe("Intercom + Linear");
  });

  it("leaves out disconnected providers, and says so when none is left", () => {
    expect(providerPairLabel([row("zendesk", "ticket_source"), row("jira", "work_tracker", "disconnected")])).toBe("Zendesk");
    expect(providerPairLabel([row("zendesk", "ticket_source", "disconnected")])).toBe("No integrations");
    expect(providerPairLabel([])).toBe("No integrations");
  });
});

describe("integrationState (the chip an operator reads)", () => {
  it("ranks what to show: disconnected, reconnect, access lost, paused, failing, stale, syncing", () => {
    expect(integrationState({ ...ok, status: "disconnected" }).label).toBe("Disconnected");
    expect(integrationState({ ...ok, status: "reauth_required", failingSince: "x" }).label).toBe("Needs reconnect");
    expect(integrationState({ ...ok, status: "permission_denied" }).label).toBe("Access lost");
    expect(integrationState({ ...ok, pollingPausedAt: "x", stale: true }).label).toBe("Paused");
    expect(integrationState({ ...ok, failingSince: "x", stale: true }).label).toBe("Failing");
    expect(integrationState({ ...ok, stale: true }).label).toBe("Stale");
    expect(integrationState(ok).label).toBe("Syncing");
  });
});
