import type { OnboardingProgressState, OnboardingStatus, ProviderOnboardingStatus } from "./types/onboarding";

const ready = (p: ProviderOnboardingStatus) => p.connected && p.backfillComplete;

/**
 * Where an organization is in the guided flow (N1.16, rebuilt for N5.1).
 * Step 1 is "a ticket source" and step 3 is "a work tracker", chosen by
 * adapter role, not by name. A ticket source counts once connected and
 * backfilled; a tracker is optional, so `ticketSourceReady` alone reaches the
 * activation screen and only `complete` (both) advances without a click.
 * Pure, so the server (activation guard) and the client (flow) agree.
 */
export function deriveOnboardingProgress(status: OnboardingStatus): OnboardingProgressState {
  const sources = status.providers.filter((p) => p.role === "ticket_source");
  const trackers = status.providers.filter((p) => p.role === "work_tracker");

  // Follow a ticket source that has finished backfilling, else one still
  // running; registry order breaks ties (the primary connector is first).
  const followed = sources.find(ready) ?? sources.find((p) => p.connected) ?? null;
  const tracker = trackers.find((p) => p.connected) ?? null;
  const ticketSourceReady = followed !== null && ready(followed);

  return {
    ticketSource: followed?.provider ?? null,
    ticketSourceReady,
    importsPolicies: followed?.capabilities.policyImport ?? false,
    tracker: tracker?.provider ?? null,
    complete: ticketSourceReady && tracker !== null,
  };
}

export const providerStatus = (status: OnboardingStatus, provider: string): ProviderOnboardingStatus | null =>
  status.providers.find((p) => p.provider === provider) ?? null;
