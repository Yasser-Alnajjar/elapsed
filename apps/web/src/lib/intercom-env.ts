import type { IntercomOAuthConfig } from "@sla/intercom";
import { getIntegrationConfig, getPrismaClient } from "@sla/db";

export const INTERCOM_STATE_COOKIE = "intercom_oauth_state";

/**
 * Resolves this organization's Intercom OAuth app config: its own client
 * id/secret, saved from the Integrations settings UI. Unlike the other
 * providers, it carries no `redirectUri`: that URL is registered once on the
 * app in Intercom's Developer Hub, not passed per request.
 */
export async function getIntercomOAuthConfig(organizationId: string): Promise<IntercomOAuthConfig> {
  const config = await getIntegrationConfig(getPrismaClient(), organizationId, "intercom");

  if (!config) {
    throw new Error("Intercom is not configured for this organization. Configure it from Integrations settings.");
  }

  return { clientId: config.clientId, clientSecret: config.clientSecret };
}
