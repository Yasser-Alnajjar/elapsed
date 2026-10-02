import type { SlackCredentials, SlackOAuthConfig } from "./types";

/**
 * Bot scopes only — no user token is requested. `chat:write` and
 * `chat:write.public` let the app post to a public channel it hasn't been
 * explicitly invited to (Phase 11 step 8: "choose a channel", not "invite a
 * bot"); `channels:read`/`groups:read` are read-only and only used to list
 * channels for the picker in settings.
 */
export const SLACK_BOT_SCOPES = ["chat:write", "chat:write.public", "channels:read", "groups:read"] as const;
const BOT_SCOPES = SLACK_BOT_SCOPES.join(",");

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";

export function buildAuthorizeUrl(config: Pick<SlackOAuthConfig, "clientId" | "redirectUri">, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", BOT_SCOPES);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

interface SlackOAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token: string;
  bot_user_id: string;
  team: { id: string; name: string };
}

export async function exchangeCodeForToken(code: string, config: SlackOAuthConfig): Promise<SlackCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack token exchange failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as SlackOAuthAccessResponse;
  if (!body.ok) {
    throw new Error(`Slack token exchange failed: ${body.error ?? "unknown error"}`);
  }

  return {
    accessToken: body.access_token,
    teamId: body.team.id,
    teamName: body.team.name,
    botUserId: body.bot_user_id,
  };
}
