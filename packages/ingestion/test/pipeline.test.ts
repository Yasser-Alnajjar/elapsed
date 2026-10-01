import { describe, expect, it } from "vitest";
import type { IntegrationProvider } from "@sla/db";
import { syncIntegration, ticketUrlRecognizers, type CanonicalBatch, type ProviderAdapter } from "../src";

const emptyBatch = (): CanonicalBatch => ({ customers: [], cases: [], eventGroups: [], deletedCaseExternalIds: [], failures: [] });

function recordingAdapter(provider: IntegrationProvider, role: ProviderAdapter["role"], log: string[], extra: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider,
    role,
    capabilities: {
      webhooks: false,
      policyImport: true,
      calendarImport: true,
      incrementalNormalization: false,
      replyEvents: false,
      priorityChanges: false,
      officialLinks: false,
    },
    ingest: async () => ({ recordsFetched: 0, counts: {} }),
    async normalize() {
      log.push("normalize");
      return { ...emptyBatch(), afterProject: async () => void log.push("afterProject") };
    },
    async correlate() {
      log.push("correlate");
      return { links: [], sweeps: [], evaluated: 3, unmatched: { noCase: 1 } };
    },
    async importCalendars() {
      log.push("importCalendars");
      return { schedulesEvaluated: 0, calendarVersionsCreated: 0, schedulesWithUnresolvedTimeZone: 0 };
    },
    async importPolicies() {
      log.push("importPolicies");
      return {
        policiesEvaluated: 0,
        policyVersionsCreated: 0,
        unsupportedConditions: 0,
        unsupportedMetrics: 0,
        policiesWithNoUsableTargets: 0,
        policiesWithUnresolvedSchedule: 0,
        policiesArchived: 0,
      };
    },
    ...extra,
  };
}

const input = (provider: IntegrationProvider, externalIds?: string[]) => ({
  prisma: {} as never,
  integration: { id: "i1", organizationId: "o1", provider, status: "connected" as const },
  mode: "full" as const,
  resolveCaseRef: null,
  ensureDefaultCalendarVersion: async () => ({ id: "cal" }),
  externalIds,
});

describe("syncIntegration", () => {
  it("normalizes a ticket source before correlating, finishes the batch, then imports calendars before policies", async () => {
    const log: string[] = [];
    const result = await syncIntegration(recordingAdapter("zendesk", "ticket_source", log), input("zendesk"));

    expect(log).toEqual(["normalize", "afterProject", "correlate", "importCalendars", "importPolicies"]);
    expect(result.correlation).toMatchObject({ evaluated: 3, unmatched: { noCase: 1 }, created: 0, unlinked: 0 });
    expect(result.policyImport).not.toBeNull();
  });

  it("correlates a tracker before normalizing, because its events are aimed at the cases its links name", async () => {
    const log: string[] = [];
    await syncIntegration(recordingAdapter("jira", "work_tracker", log, { capabilities: { ...recordingAdapter("jira", "work_tracker", []).capabilities, policyImport: false, calendarImport: false } }), input("jira"));

    expect(log).toEqual(["correlate", "normalize", "afterProject"]);
  });

  it("runs no import for a narrowed (webhook) run", async () => {
    const log: string[] = [];
    await syncIntegration(recordingAdapter("zendesk", "ticket_source", log), input("zendesk", ["42"]));

    expect(log).toEqual(["normalize", "afterProject", "correlate"]);
  });

  it("returns no correlation for an adapter without one", async () => {
    const log: string[] = [];
    const adapter = recordingAdapter("intercom", "ticket_source", log, { correlate: undefined, importCalendars: undefined, importPolicies: undefined });
    const result = await syncIntegration(adapter, input("intercom"));

    expect(result.correlation).toBeNull();
    expect(result.calendarImport).toBeNull();
  });
});

describe("ticketUrlRecognizers", () => {
  it("keeps only the adapters that recognize a case URL, keyed by provider", () => {
    const zendesk = recordingAdapter("zendesk", "ticket_source", [], { recognizeCaseUrl: (url) => (url === "u" ? "1" : null) });
    const jira = recordingAdapter("jira", "work_tracker", []);
    const recognizers = ticketUrlRecognizers({ zendesk, jira });

    expect(Object.keys(recognizers)).toEqual(["zendesk"]);
    expect(recognizers.zendesk!("u", {})).toBe("1");
  });
});
