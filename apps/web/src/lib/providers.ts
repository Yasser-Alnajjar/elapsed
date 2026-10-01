import type { SourceRole } from "@sla/core";
import type { IntegrationProvider } from "@sla/db";
import { githubAdapter, githubWebAdapter } from "@sla/github";
import type { ProviderAdapter, ProviderCapabilities, ProviderWebAdapter } from "@sla/ingestion";
import { intercomAdapter, intercomWebAdapter } from "@sla/intercom";
import { jiraAdapter, jiraWebAdapter } from "@sla/jira";
import { linearAdapter, linearWebAdapter } from "@sla/linear";
import { zendeskAdapter, zendeskWebAdapter } from "@sla/zendesk";

/**
 * Every provider the web app can reach, as static records: a provider added to
 * the `IntegrationProvider` enum is a compile error here until it has both. The
 * worker keeps its own registry of the same adapters (`apps/worker/src/providers.ts`);
 * neither is shared through a package, so no package imports every provider.
 *
 * This file is the one place outside integration-settings, OAuth, webhook and
 * concierge code that may name providers (the boundary test enforces it).
 */
export const PROVIDERS = {
  zendesk: zendeskAdapter,
  jira: jiraAdapter,
  intercom: intercomAdapter,
  linear: linearAdapter,
  github: githubAdapter,
} satisfies Record<IntegrationProvider, ProviderAdapter>;

export const WEB_PROVIDERS = {
  zendesk: zendeskWebAdapter,
  jira: jiraWebAdapter,
  intercom: intercomWebAdapter,
  linear: linearWebAdapter,
  github: githubWebAdapter,
} satisfies Record<IntegrationProvider, ProviderWebAdapter>;

const ALL_PROVIDERS = Object.keys(PROVIDERS) as IntegrationProvider[];

export const providerRole = (provider: IntegrationProvider): SourceRole => PROVIDERS[provider].role;

/** The providers a Case can come from. */
export const TICKET_SOURCE_PROVIDERS: IntegrationProvider[] = ALL_PROVIDERS.filter((p) => PROVIDERS[p].role === "ticket_source");

/** The providers a Case can be linked to: work trackers and code hosts, whose issues and pull requests are its engineering legs. */
export const ISSUE_LINK_PROVIDERS: IntegrationProvider[] = ALL_PROVIDERS.filter((p) => PROVIDERS[p].role !== "ticket_source");

export type IssueLinkSystem = IntegrationProvider;

export const isIssueLinkSystem = (system: string): system is IssueLinkSystem =>
  (ISSUE_LINK_PROVIDERS as string[]).includes(system);

/** Providers that have a capability, in registry order. */
export const providersWithCapability = (capability: keyof ProviderCapabilities): IntegrationProvider[] =>
  ALL_PROVIDERS.filter((p) => PROVIDERS[p].capabilities[capability]);

/**
 * The compliance report's provider-specific columns. The CSV format predates
 * the registry and customers read it, so its headers are fixed here instead of
 * derived: one ticket-URL column (it has only ever carried Zendesk's links) and
 * one column of linked keys per issue or pull-request provider.
 */
export const REPORT_TICKET_URL_COLUMN = { provider: "zendesk", header: "Zendesk URL" } as const satisfies {
  provider: IntegrationProvider;
  header: string;
};

export const REPORT_ISSUE_COLUMNS = [
  { provider: "jira", header: "Jira issues" },
  { provider: "linear", header: "Linear issues" },
  { provider: "github", header: "GitHub pull requests" },
] as const satisfies readonly { provider: IssueLinkSystem; header: string }[];

/** A provider's link to one of its records, from the credentials and evidence stored for it. */
export function externalUrlFor(
  provider: IntegrationProvider,
  ref: { externalId: string; credentials: unknown; evidence?: unknown },
): string | null {
  return WEB_PROVIDERS[provider].externalUrl(ref);
}
