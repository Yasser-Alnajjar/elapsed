import type { SlackOAuthConfig } from "@sla/slack";
import { getIntegrationConfig, getPrismaClient } from "@sla/db";

export const SLACK_STATE_COOKIE = "slack_oauth_state";

/**
 * Resolves this organization's Slack OAuth app config: its own client
 * id/secret, saved from the Integrations settings UI.
 */
export async function getSlackOAuthConfig(organizationId: string): Promise<SlackOAuthConfig> {
  const appUrl = process.env.NEXTAUTH_URL;
  const config = await getIntegrationConfig(getPrismaClient(), organizationId, "slack");

  if (!config || !appUrl) {
    throw new Error(
      "Slack is not configured for this organization. Configure it from Integrations settings.",
    );
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: `${appUrl}/api/integrations/slack/callback`,
  };
}
