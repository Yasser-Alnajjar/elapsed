import { SLACK_BOT_SCOPES } from "@sla/slack";
import { INTEGRATION_PROVIDER_LABELS, type IntegrationProvider } from "@/lib/types/integrations";
import { PROVIDERS, WEB_PROVIDERS } from "@/lib/providers";

/**
 * Facts for the public security summary (N5.4). Scopes are read from the same
 * constants the OAuth connect routes request, through the provider registry, so
 * the page cannot drift from what a connect actually asks for.
 */
export interface ProviderAccessFact {
  provider: IntegrationProvider;
  label: string;
  role: string;
  scopes: readonly string[];
  note: string | null;
}

export function getProviderAccessFacts(): ProviderAccessFact[] {
  return (Object.keys(WEB_PROVIDERS) as IntegrationProvider[]).map((provider) => ({
    provider,
    label: INTEGRATION_PROVIDER_LABELS[provider],
    role: PROVIDERS[provider].role,
    scopes: WEB_PROVIDERS[provider].access.scopes,
    note: WEB_PROVIDERS[provider].access.note ?? null,
  }));
}

/** Slack is outbound-only (alerts), so it is listed apart from the read-only data sources. */
export const SLACK_ACCESS_FACT = { scopes: SLACK_BOT_SCOPES } as const;
