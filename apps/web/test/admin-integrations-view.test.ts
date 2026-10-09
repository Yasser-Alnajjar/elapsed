/**
 * N10 (D33) Integration Control Center view states, rendered statically: the
 * loading skeleton, the populated list (enabled/disabled, stage, Beta access,
 * counts, health, who changed it last), the Custom REST rollout-block
 * explanation, an empty allowlist, the customer message of a disabled
 * provider, and the empty state. No database.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminIntegrationAvailabilityRow, AdminIntegrationsData } from "../src/lib/types/admin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const row = (overrides: Partial<AdminIntegrationAvailabilityRow> = {}): AdminIntegrationAvailabilityRow => ({
  provider: "zendesk",
  name: "Zendesk",
  category: "ticket_source",
  connectionType: "oauth",
  enabled: true,
  releaseStage: "stable",
  betaAccess: "allowlist",
  statusMessage: null,
  version: 0,
  updatedAt: null,
  updatedByEmail: null,
  allowlist: [],
  connections: 4,
  activeOrganizations: 3,
  pausedConnections: 0,
  health: { healthy: 2, failing: 1, needsAttention: 1, stale: 0 },
  rolloutBlock: null,
  ...overrides,
});

async function render(data: AdminIntegrationsData) {
  const { IntegrationsView } = await import("../src/modules/admin/integrations/csr/IntegrationsView");
  return renderToStaticMarkup(createElement(IntegrationsView, { initialData: data }));
}

describe("Integration Control Center view (N10)", () => {
  it("shows a loading skeleton while the page loads", async () => {
    const { default: Loading } = await import("../src/app/(admin)/admin/integrations/loading");
    const html = renderToStaticMarkup(createElement(Loading));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading integrations");
  });

  it("lists each provider with status, stage, counts, health and the last change", async () => {
    const html = await render({
      rows: [
        row({ updatedAt: "2026-10-09T12:00:00.000Z", updatedByEmail: "ops@elapsed.test", version: 3 }),
        row({ provider: "intercom", name: "Intercom", releaseStage: "beta", betaAccess: "all_organizations", connections: 1, activeOrganizations: 1 }),
      ],
      organizations: [],
    });
    expect(html).toContain("Zendesk");
    expect(html).toContain("zendesk");
    expect(html).toContain("Enabled");
    expect(html).toContain("Stable");
    expect(html).toContain("Ticket source");
    expect(html).toContain("OAuth");
    expect(html).toContain("Beta");
    expect(html).toContain("All organizations");
    expect(html).toContain("1 failing");
    expect(html).toContain("by ops@elapsed.test");
    expect(html).toContain("Version 3");
    expect(html).toContain("Default settings, never changed");
  });

  it("marks a disabled provider, its paused connections and its customer message", async () => {
    const html = await render({
      rows: [row({ enabled: false, pausedConnections: 4, statusMessage: "Paused during a Zendesk incident." })],
      organizations: [],
    });
    expect(html).toContain("Disabled");
    expect(html).toContain("Paused by policy");
    expect(html).toContain("Paused during a Zendesk incident.");
  });

  it("explains the Custom REST rollout block and an empty allowlist", async () => {
    const html = await render({
      rows: [
        row({
          provider: "custom",
          name: "Custom REST",
          connectionType: "api_credentials",
          releaseStage: "beta",
          betaAccess: "allowlist",
          rolloutBlock: { id: "N9.14-F1", reason: "Benchmark and legal review first." },
        }),
      ],
      organizations: [],
    });
    expect(html).toContain("Rollout blocked (N9.14-F1)");
    expect(html).toContain("Benchmark and legal review first.");
    expect(html).toContain("Allowlist is empty: no organization can use Custom REST right now.");
    expect(html).toContain("API credentials");
  });

  it("has an empty state", async () => {
    const html = await render({ rows: [], organizations: [] });
    expect(html).toContain("No integration providers are registered.");
  });
});
