import type { LinearCredentials } from "./types";

export interface LinearOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Read-only scope — no write access is ever requested (Phase 10: stay
 * read-only in v1). Unlike Jira's `offline_access`, Linear has no separate
 * scope for refresh tokens: its OAuth access tokens simply don't expire.
 */
export const LINEAR_OAUTH_SCOPES = ["read"] as const;
const SCOPE = LINEAR_OAUTH_SCOPES.join(" ");

const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";

/** Structured OAuth failure from an authorization-code exchange. */
export class LinearOAuthError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, options: { status: number; code?: string }) {
    super(message);
    this.name = "LinearOAuthError";
    this.status = options.status;
    this.code = options.code;
  }
}

export function buildAuthorizeUrl(
  config: Pick<LinearOAuthConfig, "clientId" | "redirectUri">,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

interface LinearTokenResponseBody {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
}

/** Linear's token endpoint takes standard OAuth2 form-encoding, unlike Atlassian's JSON body. */
export async function exchangeCodeForToken(code: string, config: LinearOAuthConfig): Promise<LinearCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    }).toString(),
  });

  const parsed = (await response.json().catch(() => null)) as LinearTokenResponseBody | null;

  if (!response.ok || !parsed?.access_token) {
    throw new LinearOAuthError(`Linear OAuth token request failed with status ${response.status}`, {
      status: response.status,
      code: parsed?.error,
    });
  }

  return {
    accessToken: parsed.access_token,
    tokenType: parsed.token_type ?? "Bearer",
    scope: parsed.scope ?? SCOPE,
  };
}
