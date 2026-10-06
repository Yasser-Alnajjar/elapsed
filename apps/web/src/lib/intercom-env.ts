import type { IntercomOAuthConfig } from "@sla/intercom";
import { getIntegrationConfig, getPrismaClient } from "@sla/db";
import { getIntercomRedirectUri } from "@/lib/intercom-redirect";

export const INTERCOM_STATE_COOKIE = "intercom_oauth_state";

/**
 * Resolves this organization's Intercom OAuth app config: its own client
 * id/secret, saved from the Integrations settings UI, plus this deployment's
 * redirect URI (sent on the authorize request; Intercom otherwise defaults to
 * the first URL registered in the Developer Hub).
 */
export async function getIntercomOAuthConfig(organizationId: string): Promise<IntercomOAuthConfig> {
  const config = await getIntegrationConfig(getPrismaClient(), organizationId, "intercom");

  if (!config) {
    throw new Error("Intercom is not configured for this organization. Configure it from Integrations settings.");
  }

  return { clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: getIntercomRedirectUri() };
}
