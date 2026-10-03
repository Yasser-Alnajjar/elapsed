import type { LinearOAuthConfig } from "@sla/linear";
import { getIntegrationConfig, getPrismaClient } from "@sla/db";

export const LINEAR_STATE_COOKIE = "linear_oauth_state";

/**
 * Resolves this organization's Linear OAuth app config: its own client
 * id/secret, saved from the Integrations settings UI.
 */
export async function getLinearOAuthConfig(
  organizationId: string,
): Promise<LinearOAuthConfig> {
  const appUrl = process.env.NEXTAUTH_URL;
  const config = await getIntegrationConfig(
    getPrismaClient(),
    organizationId,
    "linear",
  );

  if (!config || !appUrl) {
    throw new Error(
      "Linear is not configured for this organization. Configure it from Integrations settings.",
    );
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: `${appUrl}/api/integrations/linear/callback`,
  };
}
