import "server-only";
import { cache } from "react";
import { getPrismaClient, listIntegrationAvailabilityPolicies, type IntegrationProvider } from "@sla/db";
import { CATALOG_PROVIDERS, INTEGRATION_CATALOG } from "@sla/db/availability";
import { createLogger } from "@sla/logger";
import type { ReleaseStage } from "./release-stage";

const logger = createLogger({ scope: "release-stage" });

/**
 * Every provider's platform release stage, for pages that are not tied to an
 * organization (the public documentation, the home page and their search
 * metadata). It is the same persisted policy the signed-in pages show
 * (`IntegrationAvailability`, D33), read with the same function the resolver
 * uses, so a stage an operator changes in `/admin/integrations` is shown here
 * on the next request. There is no cache beyond one request.
 *
 * Pages that call this must be dynamically rendered (`export const dynamic =
 * "force-dynamic"`): a statically prerendered page would freeze the stage at
 * build time. `integration-stage-pages.test.ts` enforces that.
 *
 * If the policy cannot be read, the catalog default is shown, which is also
 * what a provider with no stored row gets. A label is never worth failing a
 * public page; nothing is enforced from this value.
 */
export const getReleaseStages = cache(async (): Promise<Record<IntegrationProvider, ReleaseStage>> => {
  try {
    const policies = await listIntegrationAvailabilityPolicies(getPrismaClient());
    return Object.fromEntries(policies.map((policy) => [policy.provider, policy.releaseStage])) as Record<IntegrationProvider, ReleaseStage>;
  } catch (error) {
    logger.warn("release_stage_read_failed", { error: error instanceof Error ? error.message : String(error) });
    return Object.fromEntries(CATALOG_PROVIDERS.map((provider) => [provider, INTEGRATION_CATALOG[provider].defaults.releaseStage])) as Record<
      IntegrationProvider,
      ReleaseStage
    >;
  }
});

export async function getReleaseStage(provider: IntegrationProvider): Promise<ReleaseStage> {
  return (await getReleaseStages())[provider];
}
