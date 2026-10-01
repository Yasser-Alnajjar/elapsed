import { describe, expect, it } from "vitest";
import type { IntegrationProvider } from "@sla/db";
import type { ProviderAdapter } from "../src";

// A registry literal as the worker and the web write it: `satisfies Record<…>`
// makes a missing provider a compile error, which `pnpm type-check` enforces.
const adapterFor = (provider: IntegrationProvider, role: ProviderAdapter["role"]): ProviderAdapter => ({
  provider,
  role,
  capabilities: {
    webhooks: false,
    policyImport: false,
    calendarImport: false,
    incrementalNormalization: false,
    replyEvents: false,
    priorityChanges: false,
    officialLinks: false,
  },
  ingest: async () => ({ recordsFetched: 0, counts: {} }),
  normalize: async () => ({ customers: [], cases: [], eventGroups: [], deletedCaseExternalIds: [], failures: [] }),
});

const REGISTRY = {
  zendesk: adapterFor("zendesk", "ticket_source"),
  intercom: adapterFor("intercom", "ticket_source"),
  jira: adapterFor("jira", "work_tracker"),
  linear: adapterFor("linear", "work_tracker"),
  github: adapterFor("github", "code_host"),
} satisfies Record<IntegrationProvider, ProviderAdapter>;

describe("ProviderAdapter", () => {
  it("is satisfiable by a minimal adapter for every provider", async () => {
    for (const [provider, adapter] of Object.entries(REGISTRY)) {
      expect(adapter.provider).toBe(provider);
    }
    const batch = await REGISTRY.jira.normalize({
      prisma: {} as never,
      integration: { id: "i", organizationId: "o", provider: "jira", status: "connected" },
      mode: "full",
    });
    expect(batch.cases).toEqual([]);
  });
});
