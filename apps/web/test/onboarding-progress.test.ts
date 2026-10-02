/**
 * N5.1: onboarding is built from adapter roles and capabilities, not from
 * provider names. A ticket source is step 1, a work tracker is the optional
 * step 3. `deriveOnboardingProgress` is the single place the flow (client) and
 * the activation guard (server) read that from.
 */
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../src/lib/providers";
import { deriveOnboardingProgress, providerStatus } from "../src/lib/onboarding-progress";
import { INTEGRATION_PROVIDER_LABELS, type IntegrationProvider } from "../src/lib/types/integrations";
import type { OnboardingStatus, ProviderOnboardingStatus } from "../src/lib/types/onboarding";

type Phase = "none" | "running" | "done";

/** Every provider in registry order, each at the given phase (default: not connected). */
const status = (phases: Partial<Record<IntegrationProvider, Phase>>): OnboardingStatus => ({
  providers: (Object.keys(PROVIDERS) as IntegrationProvider[]).map((provider): ProviderOnboardingStatus => {
    const phase = phases[provider] ?? "none";
    return {
      provider,
      label: INTEGRATION_PROVIDER_LABELS[provider],
      role: PROVIDERS[provider].role,
      capabilities: PROVIDERS[provider].capabilities,
      access: { scopes: [], note: null },
      connected: phase !== "none",
      backfillComplete: phase === "done",
      reauthRequired: false,
      subdomain: null,
      config: { configured: true, clientId: "id" },
    };
  }),
  ticketsFetched: 0,
  escalatedCases: 0,
  linkedIssues: 0,
});

describe("deriveOnboardingProgress", () => {
  it("starts with no ticket source", () => {
    expect(deriveOnboardingProgress(status({}))).toEqual({
      ticketSource: null,
      ticketSourceReady: false,
      importsPolicies: false,
      tracker: null,
      complete: false,
    });
  });

  it("treats every ticket-source x tracker pair the same way", () => {
    const sources = (Object.keys(PROVIDERS) as IntegrationProvider[]).filter((p) => PROVIDERS[p].role === "ticket_source");
    const trackers = (Object.keys(PROVIDERS) as IntegrationProvider[]).filter((p) => PROVIDERS[p].role === "work_tracker");
    expect(sources.length * trackers.length).toBeGreaterThanOrEqual(4);

    for (const source of sources) {
      for (const tracker of trackers) {
        expect(deriveOnboardingProgress(status({ [source]: "done", [tracker]: "running" }))).toEqual({
          ticketSource: source,
          ticketSourceReady: true,
          importsPolicies: PROVIDERS[source].capabilities.policyImport,
          tracker,
          complete: true,
        });
        // A tracker alone is not enough, and a source still backfilling is not ready.
        expect(deriveOnboardingProgress(status({ [tracker]: "done" })).complete).toBe(false);
        expect(deriveOnboardingProgress(status({ [source]: "running", [tracker]: "done" })).complete).toBe(false);
      }
    }
  });

  it("a ticket source alone is ready for activation but not complete: the tracker is optional (N5.2)", () => {
    expect(deriveOnboardingProgress(status({ zendesk: "done" }))).toMatchObject({
      ticketSourceReady: true,
      tracker: null,
      complete: false,
    });
  });

  it("reads policy import off the capability, not the provider", () => {
    expect(deriveOnboardingProgress(status({ zendesk: "done" })).importsPolicies).toBe(PROVIDERS.zendesk.capabilities.policyImport);
    expect(deriveOnboardingProgress(status({ intercom: "done" })).importsPolicies).toBe(PROVIDERS.intercom.capabilities.policyImport);
    expect(PROVIDERS.zendesk.capabilities.policyImport).toBe(true);
    expect(PROVIDERS.intercom.capabilities.policyImport).toBe(false);
  });

  it("follows the ticket source that finished backfilling, registry order on a tie", () => {
    expect(deriveOnboardingProgress(status({ zendesk: "running", intercom: "done" })).ticketSource).toBe("intercom");
    expect(deriveOnboardingProgress(status({ zendesk: "done", intercom: "done" })).ticketSource).toBe("zendesk");
    expect(deriveOnboardingProgress(status({ zendesk: "running", intercom: "running" })).ticketSource).toBe("zendesk");
  });

  it("a code host never completes the tracker step", () => {
    expect(deriveOnboardingProgress(status({ zendesk: "done", github: "done" }))).toMatchObject({ tracker: null, complete: false });
  });

  it("looks a provider up by name", () => {
    expect(providerStatus(status({ jira: "done" }), "jira")).toMatchObject({ connected: true });
    expect(providerStatus(status({}), "nope")).toBeNull();
  });
});
