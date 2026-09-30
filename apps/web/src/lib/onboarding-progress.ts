import type { OnboardingProgressState, OnboardingStatus, ProviderOnboardingStatus } from "./types/onboarding";

const ready = (p: ProviderOnboardingStatus) => p.connected && p.backfillComplete;

/**
 * Where an organization is in the guided flow (N1.16). "Step 1 complete" means
 * *a ticket source* — Zendesk or Intercom — is connected and its backfill is
 * complete; "step 3 complete" means a tracker — Jira or Linear — is connected.
 * Pure, so the server (activation guard) and the client (flow) agree.
 */
export function deriveOnboardingProgress(status: OnboardingStatus): OnboardingProgressState {
  // Follow a ticket source that has finished backfilling, else one still
  // running; Zendesk wins ties (it is the primary connector).
  const ticketSource = ready(status.zendesk)
    ? "zendesk"
    : ready(status.intercom)
      ? "intercom"
      : status.zendesk.connected
        ? "zendesk"
        : status.intercom.connected
          ? "intercom"
          : null;
  const ticketSourceReady = ready(status.zendesk) || ready(status.intercom);
  const tracker = status.jira.connected ? "jira" : status.linear.connected ? "linear" : null;
  return { ticketSource, ticketSourceReady, tracker, complete: ticketSourceReady && tracker !== null };
}
