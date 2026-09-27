import type { IntegrationConfigStatus } from "./integrations";
import type { UnmatchedCaseRow } from "./dashboard";
import type { SlaPolicySummary } from "./sla-configuration";

export interface ProviderOnboardingStatus {
  connected: boolean;
  backfillComplete: boolean;
  reauthRequired: boolean;
}

export interface OnboardingStatus {
  zendesk: ProviderOnboardingStatus;
  jira: ProviderOnboardingStatus;
  /** Whether this org has saved its own OAuth app config for each provider yet — gates the connect UI (W4). */
  zendeskConfig: IntegrationConfigStatus;
  jiraConfig: IntegrationConfigStatus;
  /** Gates the onboarding step 3 "alternative issue tracker" connect buttons (Linear/GitHub), same as Jira/Zendesk above. */
  linearConfig: IntegrationConfigStatus;
  githubConfig: IntegrationConfigStatus;
  /** Raw ticket snapshots landed so far — ticks up while backfill is in flight. */
  ticketsFetched: number;
  /** Cases with at least one Jira case link. */
  escalatedCases: number;
  /** Jira case-link rows (a case can in principle hold more than one). */
  linkedIssues: number;
}

export interface OnboardingPageData {
  status: OnboardingStatus;
  zendeskSubdomain: string | null;
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
  /** Null when no import has run yet (e.g. Zendesk not connected). */
  lastImportAt: string | null;
}
