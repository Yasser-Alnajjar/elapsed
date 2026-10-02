import type { ZendeskCredentials } from "./types";

export interface ZendeskOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Read-only scope — no write access is ever requested (Phase 10: stay read-only in v1). */
export const ZENDESK_OAUTH_SCOPES = ["read"] as const;
const SCOPE = ZENDESK_OAUTH_SCOPES.join(" ");

/**
 * Structured OAuth failure. `requiresReauth` is only ever true for a refresh
 * attempt whose refresh_token was rejected — never for an authorization-code
 * exchange, where the right response is simply to let the user retry connect.
 */
export class ZendeskOAuthError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly description?: string;
  readonly requiresReauth: boolean;

  constructor(
    message: string,
    options: { status: number; code?: string; description?: string; requiresReauth: boolean },
  ) {
    super(message);
    this.name = "ZendeskOAuthError";
    this.status = options.status;
    this.code = options.code;
    this.description = options.description;
    this.requiresReauth = options.requiresReauth;
  }
}

export function buildAuthorizeUrl(
  subdomain: string,
  config: Pick<ZendeskOAuthConfig, "clientId" | "redirectUri">,
  state: string,
): string {
  // Note: Zendesk does not accept an `expires_in`/expiration request parameter here.
  // Whether the token exchange below returns a refresh_token + expires_in at all is
  // determined by the "Token rotation" setting on the OAuth client in Zendesk admin,
  // not by anything in the authorize request. exchangeCodeForToken/refreshAccessToken
  // below handle both the expiring and non-expiring cases.
  const url = new URL(`https://${subdomain}.zendesk.com/oauth/authorizations/new`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

interface ZendeskTokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postTokenRequest(
  subdomain: string,
  body: Record<string, string>,
  isRefresh: boolean,
): Promise<ZendeskTokenResponseBody> {
  const response = await fetch(`https://${subdomain}.zendesk.com/oauth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const parsed = (await response.json().catch(() => null)) as ZendeskTokenResponseBody | null;

  if (!response.ok) {
    throw new ZendeskOAuthError(`Zendesk OAuth token request failed with status ${response.status}`, {
      status: response.status,
      code: parsed?.error,
      description: parsed?.error_description,
      // A rejected authorization code just means "connect failed, try again" — only a
      // rejected refresh_token means the integration itself needs reauthorization.
      requiresReauth: isRefresh && (response.status === 401 || parsed?.error === "invalid_grant"),
    });
  }

  if (!parsed?.access_token) {
    throw new ZendeskOAuthError("Zendesk OAuth token response was missing access_token", {
      status: response.status,
      requiresReauth: false,
    });
  }

  return parsed;
}

function toCredentials(
  subdomain: string,
  body: ZendeskTokenResponseBody,
  previousRefreshToken?: string,
): ZendeskCredentials {
  const now = Date.now();
  const credentials: ZendeskCredentials = {
    subdomain,
    accessToken: body.access_token as string,
    tokenType: body.token_type ?? "bearer",
    scope: body.scope ?? SCOPE,
  };

  // Zendesk doesn't always return a fresh refresh_token on rotation; when it doesn't,
  // RFC 6749 says the client should keep using the one it already has.
  const refreshToken = body.refresh_token ?? previousRefreshToken;
  if (refreshToken) credentials.refreshToken = refreshToken;

  if (typeof body.expires_in === "number") {
    credentials.expiresAt = now + body.expires_in * 1000;
  }
  if (typeof body.refresh_token_expires_in === "number") {
    credentials.refreshTokenExpiresAt = now + body.refresh_token_expires_in * 1000;
  }

  return credentials;
}

export async function exchangeCodeForToken(
  subdomain: string,
  code: string,
  config: ZendeskOAuthConfig,
): Promise<ZendeskCredentials> {
  const body = await postTokenRequest(
    subdomain,
    {
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      scope: SCOPE,
    },
    false,
  );

  return toCredentials(subdomain, body);
}

/**
 * Exchanges a refresh_token for a new access_token. If Zendesk rotates the
 * refresh token, the new one replaces the old — callers must persist whatever
 * this returns, not assume `refreshToken` is unchanged.
 */
export async function refreshAccessToken(
  subdomain: string,
  refreshToken: string,
  config: Pick<ZendeskOAuthConfig, "clientId" | "clientSecret">,
): Promise<ZendeskCredentials> {
  const body = await postTokenRequest(
    subdomain,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    },
    true,
  );

  return toCredentials(subdomain, body, refreshToken);
}
