import type { SourceRole } from "@sla/core";
import type { ProviderCapabilities } from "@sla/ingestion";
import type { IntegrationConfigStatus, IntegrationProvider , ProviderAvailabilityView } from "./integrations";
import type { AtRiskRow, UnmatchedCaseRow } from "./dashboard";
import type { FindingsData } from "./findings";
import type { SlaPolicySummary } from "./sla-configuration";

/**
 * One provider as the wizard sees it. `role` and `capabilities` come from the
 * adapter registry, so the steps follow what a provider can do instead of
 * which provider it is (N5.1). Plain data, so it crosses to the client; the
 * registry itself never does.
 */
export interface ProviderOnboardingStatus {
  provider: IntegrationProvider;
  label: string;
  role: SourceRole;
  capabilities: ProviderCapabilities;
  /** The read-only grant connecting this provider requests, from its adapter. */
  access: { scopes: readonly string[]; note: string | null };
  /** Connected with live credentials, including one that needs a reconnect; a disconnected row is not connected. */
  connected: boolean;
  backfillComplete: boolean;
  reauthRequired: boolean;
  /** The workspace subdomain stored with the credentials, when the provider has one: some reconnect links need it. */
  subdomain: string | null;
  /** Whether this org has saved its own OAuth app config for the provider yet; gates the connect UI (W4). */
  config: IntegrationConfigStatus;
  /** Platform availability (D33): the Beta label, and whether it can be connected now. */
  availability: ProviderAvailabilityView;
}

export interface OnboardingStatus {
  /** Every provider, in registry order. */
  providers: ProviderOnboardingStatus[];
  /** Raw ticket/conversation snapshots landed so far, across ticket sources; ticks up while backfill is in flight. */
  ticketsFetched: number;
  /** Cases with at least one work-tracker link. */
  escalatedCases: number;
  /** Work-tracker case-link rows (a case can in principle hold more than one). */
  linkedIssues: number;
}

export interface OnboardingPageData {
  status: OnboardingStatus;
}

/** Where an organization is in the guided flow, derived from `OnboardingStatus`; see `deriveOnboardingProgress`. */
export interface OnboardingProgressState {
  /** The ticket source the flow follows: one that finished backfilling, else one still running, else none yet. */
  ticketSource: IntegrationProvider | null;
  /** A ticket source is connected and its first backfill has completed. Enough to reach the activation screen. */
  ticketSourceReady: boolean;
  /** Whether the followed ticket source imports SLA policies; false means the step is "create a first native policy". */
  importsPolicies: boolean;
  /** The connected work tracker, or null. A tracker is optional (N5.2). */
  tracker: IntegrationProvider | null;
  /** Ticket source ready and a tracker connected: the only state that advances on its own. */
  complete: boolean;
}

/** What the last SLA policy import (Phase 1.12's `SlaImportSummary`) silently dropped or couldn't place, surfaced for the onboarding review screen (Phase 6.7) instead of only logs. */
export interface PolicyImportWarnings {
  unsupportedConditions: number;
  unsupportedMetrics: number;
  policiesWithNoUsableTargets: number;
  policiesWithUnresolvedSchedule: number;
  policiesArchived: number;
}

/**
 * The onboarding "review your imported policies" screen's read model (Phase
 * 6.7): Imported (active imported policies) / Matched (open cases with a
 * commitment) / No match (open cases with none — Phase 6.2's same query) /
 * Warnings (from `SlaImportSummary`).
 */
export interface PolicyImportReview {
  importedPolicies: SlaPolicySummary[];
  matchedCaseCount: number;
  unmatchedCaseCount: number;
  unmatchedCases: UnmatchedCaseRow[];
  unmatchedOverflowCount: number;
  warnings: PolicyImportWarnings;
  /** Null when no import has run yet (no policy-importing source connected). */
  lastImportAt: string | null;
  /** The connected source whose policies are imported ("your helpdesk" when none is), for the screen's copy. */
  sourceLabel: string;
}

/**
 * The onboarding completion screen's read model (Phase 6 "Step 4 —
 * activation"): reached once a ticket source is connected with its backfill
 * done; a tracker is optional (N5.2). Built entirely from data the product
 * already computes elsewhere (dashboard at-risk rows, integration and
 * notification status, imported policy count): nothing here is invented for
 * this screen.
 */
export interface ActivationPageData {
  status: OnboardingStatus;
  /** First few open commitments by urgency, straight from the real dashboard reconstruction. */
  atRiskPreview: AtRiskRow[];
  /** Total open at-risk/breached commitments — may exceed `atRiskPreview.length`. */
  atRiskTotal: number;
  slackConnected: boolean;
  emailConfigured: boolean;
  importedPolicyCount: number;
  /** What the historical backfill found — folded into this same screen instead of a separate "findings" page. */
  findings: FindingsData;
}
