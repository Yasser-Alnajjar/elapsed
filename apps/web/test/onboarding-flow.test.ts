/**
 * N5.1 / N5.2: the guided flow renders any supported ticket source x tracker
 * pair from the same code, takes its wording and its policy step from the
 * adapter registry, and treats the tracker as optional.
 *
 * Server-rendered to static markup with the router and the client actions
 * stubbed: effects do not run, so each case is one frame of the flow.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { catalogEntry } from "@sla/db/availability";
import type { OnboardingStatus } from "@/lib/types/onboarding";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/actions/client", () => ({
  Actions: { Onboarding: { getProgress: vi.fn(), startBackfill: vi.fn() } },
}));

import { OnboardingFlow } from "@modules/onboarding/onboarding/csr/OnboardingFlow";
import { PROVIDERS } from "@/lib/providers";
import { INTEGRATION_PROVIDER_LABELS, type IntegrationProvider } from "@/lib/types/integrations";

type Phase = "none" | "running" | "done";

const status = (phases: Partial<Record<IntegrationProvider, Phase>>, counts?: Partial<OnboardingStatus>): OnboardingStatus => ({
  providers: (Object.keys(PROVIDERS) as IntegrationProvider[]).map((provider) => {
    const phase = phases[provider] ?? "none";
    return {
      provider,
      label: INTEGRATION_PROVIDER_LABELS[provider],
      role: PROVIDERS[provider].role,
      capabilities: PROVIDERS[provider].capabilities,
      access: { scopes: ["read"], note: null },
      connected: phase !== "none",
      backfillComplete: phase === "done",
      reauthRequired: false,
      subdomain: null,
      config: { configured: true, clientId: "id" },
      // D33: every provider available, at its seeded release stage (Intercom and GitHub Beta).
      availability: { available: true, releaseStage: catalogEntry(provider).defaults.releaseStage, code: null, message: null, statusMessage: null },
    };
  }),
  ticketsFetched: 0,
  escalatedCases: 0,
  linkedIssues: 0,
  ...counts,
});

const render = (s: OnboardingStatus) => renderToStaticMarkup(createElement(OnboardingFlow, { initialStatus: s }));

describe("onboarding flow", () => {
  it("offers every ticket source on the first screen, the primary one first", () => {
    const html = render(status({}));
    expect(html).toContain("Connect your support helpdesk");
    expect(html).toContain("Primary connector");
    expect(html.indexOf("Zendesk")).toBeLessThan(html.indexOf("Intercom"));
    expect(html).toContain("Beta"); // Intercom is not promoted out of Beta (D17)
    expect(html).not.toContain("Continue without a tracker");
  });

  it("prints the scopes the adapter publishes, not a copy", () => {
    expect(render(status({}))).toContain("Read-only scopes enforced");
  });

  describe.each([
    ["zendesk", "jira"],
    ["zendesk", "linear"],
    ["intercom", "jira"],
    ["intercom", "linear"],
  ] as const)("%s + %s", (source, tracker) => {
    const sourceLabel = INTEGRATION_PROVIDER_LABELS[source];
    const trackerLabel = INTEGRATION_PROVIDER_LABELS[tracker];

    it("shows backfill progress while the source is still ingesting", () => {
      const html = render(status({ [source]: "running" }, { ticketsFetched: 12 }));
      expect(html).toContain("Ingesting 90 days of historical");
      expect(html).toContain(`Read-only handshake established with your ${sourceLabel} workspace`);
      expect(html).toContain("12");
    });

    it("completes once the tracker is connected, naming both", () => {
      const html = render(status({ [source]: "done", [tracker]: "running" }));
      expect(html).toContain("Setup complete");
      expect(html).toContain("FINDINGS_READY");
      expect(html).toContain(`${sourceLabel} backfill complete — ${trackerLabel} is still catching up in the background`);
    });
  });

  it("a source that imports policies stops to review them before the tracker (capability policyImport)", () => {
    expect(PROVIDERS.zendesk.capabilities.policyImport).toBe(true);
    const html = render(status({ zendesk: "done" }));
    expect(html).toContain("Review policies");
    expect(html).not.toContain("Create your first policy");
    expect(html).not.toContain("Continue without a tracker");
  });

  it("a source without policy import offers a first native policy and goes straight to the optional tracker step", () => {
    expect(PROVIDERS.intercom.capabilities.policyImport).toBe(false);
    const html = render(status({ intercom: "done" }));
    expect(html).toContain("Create your first policy");
    expect(html).not.toContain("Review policies");
    expect(html).toContain("Connect engineering to close the SLA blindspot");
    expect(html).toContain("Continue without a tracker");
    expect(html).toContain("/onboarding/activation");
  });

  it("offers the other trackers and the code hosts as alternatives to the primary one", () => {
    const html = render(status({ intercom: "done" }));
    expect(html).toContain("Or choose another issue tracker");
    expect(html).toContain("Linear");
    expect(html).toContain("GitHub");
  });

  it("asks for a reconnect when the ticket source's token stopped working", () => {
    const s = status({ intercom: "done" });
    s.providers.find((p) => p.provider === "intercom")!.reauthRequired = true;
    const html = render(s);
    expect(html).toContain("Reconnect Intercom");
    expect(html).toContain("/api/integrations/intercom/connect");
  });
});
