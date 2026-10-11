import type { IntegrationBetaAccess, IntegrationProvider, IntegrationReleaseStage } from "../generated/prisma/client";

/** What a provider is to the product. Matches the adapter's `role` (`ProviderAdapter.role`). */
export type IntegrationCategory = "ticket_source" | "work_tracker" | "code_host";

/** How a customer connects it: a provider OAuth (or app) consent flow, or API credentials they enter. */
export type IntegrationConnectionType = "oauth" | "api_credentials";

export interface IntegrationAvailabilityDefaults {
  enabled: boolean;
  releaseStage: IntegrationReleaseStage;
  betaAccess: IntegrationBetaAccess;
}

export interface IntegrationCatalogEntry {
  name: string;
  category: IntegrationCategory;
  connectionType: IntegrationConnectionType;
  /** Used when the provider has no `IntegrationAvailability` row yet; the N10 migration seeds the same values. */
  defaults: IntegrationAvailabilityDefaults;
}

/**
 * The static half of the integration capability registry (D33, plan 10 §4.2):
 * what each statically registered provider is, and its default availability.
 * A provider added to `IntegrationProvider` does not compile until it has an
 * entry here (D16: registration stays static). Whether a provider may be used
 * right now is the persisted half, `IntegrationAvailability`, read through
 * `resolveIntegrationAvailability`.
 */
export const INTEGRATION_CATALOG = {
  zendesk: {
    name: "Zendesk",
    category: "ticket_source",
    connectionType: "oauth",
    defaults: { enabled: true, releaseStage: "stable", betaAccess: "allowlist" },
  },
  jira: {
    name: "Jira",
    category: "work_tracker",
    connectionType: "oauth",
    defaults: { enabled: true, releaseStage: "stable", betaAccess: "allowlist" },
  },
  // Promoted out of Beta on 2026-10-05 (D17 amendment).
  linear: {
    name: "Linear",
    category: "work_tracker",
    connectionType: "oauth",
    defaults: { enabled: true, releaseStage: "stable", betaAccess: "allowlist" },
  },
  intercom: {
    name: "Intercom",
    category: "ticket_source",
    connectionType: "oauth",
    defaults: { enabled: true, releaseStage: "beta", betaAccess: "all_organizations" },
  },
  github: {
    name: "GitHub",
    category: "code_host",
    connectionType: "oauth",
    defaults: { enabled: true, releaseStage: "beta", betaAccess: "all_organizations" },
  },
  custom: {
    name: "Custom REST",
    category: "ticket_source",
    connectionType: "api_credentials",
    defaults: { enabled: true, releaseStage: "beta", betaAccess: "allowlist" },
  },
} as const satisfies Record<IntegrationProvider, IntegrationCatalogEntry>;

/** Every provider, in catalog order. */
export const CATALOG_PROVIDERS = Object.keys(INTEGRATION_CATALOG) as IntegrationProvider[];

export function catalogEntry(provider: IntegrationProvider): IntegrationCatalogEntry {
  return INTEGRATION_CATALOG[provider];
}
