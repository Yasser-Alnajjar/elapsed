/**
 * N1.16: onboarding treats a *ticket source* (Zendesk or Intercom) as step 1
 * and a *tracker* (Jira or Linear) as step 3. `deriveOnboardingProgress` is
 * the single place both the flow (client) and the activation guard (server)
 * read that from.
 */
import { describe, expect, it } from "vitest";
import { deriveOnboardingProgress } from "../src/lib/onboarding-progress";
import type { OnboardingStatus, ProviderOnboardingStatus } from "../src/lib/types/onboarding";

const none: ProviderOnboardingStatus = { connected: false, backfillComplete: false, reauthRequired: false };
const running: ProviderOnboardingStatus = { connected: true, backfillComplete: false, reauthRequired: false };
const done: ProviderOnboardingStatus = { connected: true, backfillComplete: true, reauthRequired: false };
const config = { configured: true } as OnboardingStatus["zendeskConfig"];

const status = (overrides: Partial<Pick<OnboardingStatus, "zendesk" | "intercom" | "jira" | "linear">>): OnboardingStatus => ({
  zendesk: none,
  intercom: none,
  jira: none,
  linear: none,
  zendeskConfig: config,
  intercomConfig: config,
  jiraConfig: config,
  linearConfig: config,
  githubConfig: config,
  ticketsFetched: 0,
  escalatedCases: 0,
  linkedIssues: 0,
  ...overrides,
});

describe("deriveOnboardingProgress", () => {
  it("starts with no ticket source", () => {
    expect(deriveOnboardingProgress(status({}))).toEqual({
      ticketSource: null,
      ticketSourceReady: false,
      tracker: null,
      complete: false,
    });
  });

  it("Zendesk + Jira completes exactly as before", () => {
    expect(deriveOnboardingProgress(status({ zendesk: done, jira: running })).complete).toBe(true);
    expect(deriveOnboardingProgress(status({ zendesk: running, jira: done })).complete).toBe(false);
    expect(deriveOnboardingProgress(status({ zendesk: done })).complete).toBe(false);
  });

  it("an Intercom-only organization can complete with Jira or with Linear", () => {
    const withJira = deriveOnboardingProgress(status({ intercom: done, jira: running }));
    expect(withJira).toEqual({ ticketSource: "intercom", ticketSourceReady: true, tracker: "jira", complete: true });

    const withLinear = deriveOnboardingProgress(status({ intercom: done, linear: running }));
    expect(withLinear).toEqual({ ticketSource: "intercom", ticketSourceReady: true, tracker: "linear", complete: true });
  });

  it("Intercom is not ready until its backfill completes, and a tracker alone is not enough", () => {
    expect(deriveOnboardingProgress(status({ intercom: running, linear: done })).complete).toBe(false);
    expect(deriveOnboardingProgress(status({ jira: done })).complete).toBe(false);
  });

  it("follows the ticket source that finished backfilling, Zendesk first on a tie", () => {
    expect(deriveOnboardingProgress(status({ zendesk: running, intercom: done })).ticketSource).toBe("intercom");
    expect(deriveOnboardingProgress(status({ zendesk: done, intercom: done })).ticketSource).toBe("zendesk");
    expect(deriveOnboardingProgress(status({ zendesk: running, intercom: running })).ticketSource).toBe("zendesk");
  });
});
