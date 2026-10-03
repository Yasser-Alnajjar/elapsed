import type { JiraOAuthConfig } from "@sla/jira";
import { getIntegrationConfig, getPrismaClient } from "@sla/db";

export const JIRA_STATE_COOKIE = "jira_oauth_state";

/**
 * Resolves this organization's Jira OAuth app config: its own client
 * id/secret, saved from the Integrations settings UI.
 */
export async function getJiraOAuthConfig(organizationId: string): Promise<JiraOAuthConfig> {
  const appUrl = process.env.NEXTAUTH_URL;
  const config = await getIntegrationConfig(getPrismaClient(), organizationId, "jira");

  if (!config || !appUrl) {
    throw new Error(
      "Jira is not configured for this organization. Configure it from Integrations settings.",
    );
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: `${appUrl}/api/integrations/jira/callback`,
  };
}
