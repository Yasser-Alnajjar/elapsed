import type { JiraAccessibleResource, JiraCredentials } from "./types";

export interface JiraOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Read-only scopes — no write access is ever requested (Phase 10: stay
 * read-only in v1). `offline_access` is required to receive a refresh token.
 */
export const JIRA_OAUTH_SCOPES = ["read:jira-work", "offline_access"] as const;
const SCOPE = JIRA_OAUTH_SCOPES.join(" ");

const AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";

/**
 * Structured OAuth failure. `requiresReauth` is only ever true for a refresh
 * attempt whose refresh_token was rejected — never for an authorization-code
 * exchange, where the right response is simply to let the user retry connect.
 */
export class JiraOAuthError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly description?: string;
  readonly requiresReauth: boolean;

  constructor(
    message: string,
    options: { status: number; code?: string; description?: string; requiresReauth: boolean },
  ) {
    super(message);
    this.name = "JiraOAuthError";
    this.status = options.status;
    this.code = options.code;
    this.description = options.description;
    this.requiresReauth = options.requiresReauth;
  }
}

export function buildAuthorizeUrl(
  config: Pick<JiraOAuthConfig, "clientId" | "redirectUri">,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

interface JiraTokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postTokenRequest(body: Record<string, string>, isRefresh: boolean): Promise<JiraTokenResponseBody> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const parsed = (await response.json().catch(() => null)) as JiraTokenResponseBody | null;

  if (!response.ok) {
    throw new JiraOAuthError(`Jira OAuth token request failed with status ${response.status}`, {
      status: response.status,
      code: parsed?.error,
      description: parsed?.error_description,
      // Atlassian rejects a dead refresh_token with invalid_grant (typically 400, sometimes
      // 401) — only a rejected refresh_token means the integration itself needs
      // reauthorization; a rejected authorization code just means "connect failed, retry."
      requiresReauth: isRefresh && (response.status === 401 || parsed?.error === "invalid_grant"),
    });
  }

  if (!parsed?.access_token) {
    throw new JiraOAuthError("Jira OAuth token response was missing access_token", {
      status: response.status,
      requiresReauth: false,
    });
  }

  return parsed;
}

function toCredentials(
  body: JiraTokenResponseBody,
  cloudId: string,
  siteUrl: string,
  previousRefreshToken?: string,
): JiraCredentials {
  const credentials: JiraCredentials = {
    cloudId,
    siteUrl,
    accessToken: body.access_token as string,
    tokenType: body.token_type ?? "bearer",
    scope: body.scope ?? SCOPE,
  };

  // Atlassian rotates the refresh_token on every use but, per RFC 6749, the client should
  // keep using the one it already has if a fresh one isn't returned.
  const refreshToken = body.refresh_token ?? previousRefreshToken;
  if (refreshToken) credentials.refreshToken = refreshToken;

  if (typeof body.expires_in === "number") {
    credentials.expiresAt = Date.now() + body.expires_in * 1000;
  }

  return credentials;
}

async function resolveAccessibleSite(accessToken: string): Promise<JiraAccessibleResource> {
  const resourcesResponse = await fetch(ACCESSIBLE_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (!resourcesResponse.ok) {
    throw new Error(
      `Jira accessible-resources lookup failed: ${resourcesResponse.status} ${await resourcesResponse.text()}`,
    );
  }

  const resources = (await resourcesResponse.json()) as JiraAccessibleResource[];
  const site = resources[0];
  if (!site) {
    throw new Error("Jira authorization granted no accessible sites");
  }
  return site;
}

/**
 * Exchanges the authorization code for a token, then resolves the Jira Cloud
 * site to talk to via the accessible-resources endpoint. v1 assumes one Jira
 * site is granted per org and uses the first one returned.
 */
export async function exchangeCodeForToken(code: string, config: JiraOAuthConfig): Promise<JiraCredentials> {
  const body = await postTokenRequest(
    {
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    },
    false,
  );

  const site = await resolveAccessibleSite(body.access_token as string);
  return toCredentials(body, site.id, site.url);
}

/**
 * Exchanges a refresh_token for a new access_token. Atlassian rotates the
 * refresh token on (almost) every use — callers must persist whatever this
 * returns, not assume `refreshToken` is unchanged. The Jira site itself
 * cannot change across a refresh, so `cloudId`/`siteUrl` are carried over
 * from `current` rather than re-resolved via accessible-resources.
 */
export async function refreshAccessToken(
  current: Pick<JiraCredentials, "cloudId" | "siteUrl">,
  refreshToken: string,
  config: Pick<JiraOAuthConfig, "clientId" | "clientSecret">,
): Promise<JiraCredentials> {
  const body = await postTokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    },
    true,
  );

  return toCredentials(body, current.cloudId, current.siteUrl, refreshToken);
}
