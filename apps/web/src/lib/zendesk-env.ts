import type { ZendeskOAuthConfig } from "@sla/zendesk";
import { getIntegrationConfig, getPrismaClient } from "@sla/db";

export const ZENDESK_STATE_COOKIE = "zendesk_oauth_state";

/**
 * Resolves this organization's Zendesk OAuth app config: its own client
 * id/secret, saved from the Integrations settings UI.
 */
export async function getZendeskOAuthConfig(organizationId: string): Promise<ZendeskOAuthConfig> {
  const appUrl = process.env.NEXTAUTH_URL;
  const config = await getIntegrationConfig(getPrismaClient(), organizationId, "zendesk");

  if (!config || !appUrl) {
    throw new Error(
      "Zendesk is not configured for this organization. Configure it from Integrations settings.",
    );
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: `${appUrl}/api/integrations/zendesk/callback`,
  };
}
