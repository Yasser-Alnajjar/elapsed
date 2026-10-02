import type { GithubTokenCredentials } from "./types";

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * No `scope` is requested. The client id/secret belong to a GitHub App, not
 * a classic OAuth App: a GitHub App's user access token is limited to the
 * permissions the App was registered with (Pull requests: read, Contents:
 * read) and to the repositories it is installed on, and GitHub ignores
 * `scope` for it. That gives GitHub the same read-only grant every other
 * provider in this codebase gets.
 *
 * Connections made before roadmap step 38 used a classic OAuth App with the
 * write-capable `repo` scope. Their stored tokens keep working until the
 * organization switches to a GitHub App and reconnects.
 */
/** Where read-only access is enforced for GitHub: the GitHub App's registered permissions, not a request parameter. */
export const GITHUB_ACCESS_NOTE =
  "Read-only access is set by the permissions of the GitHub App you register (Pull requests: read, Contents: read), limited to the repositories it is installed on; GitHub ignores a scope parameter for an App.";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Structured OAuth failure. `requiresReauth` is only true for a refresh
 * attempt whose refresh_token was rejected. For an authorization-code
 * exchange, the user just retries connecting.
 */
export class GithubOAuthError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requiresReauth: boolean;

  constructor(message: string, options: { status: number; code?: string; requiresReauth?: boolean }) {
    super(message);
    this.name = "GithubOAuthError";
    this.status = options.status;
    this.code = options.code;
    this.requiresReauth = options.requiresReauth ?? false;
  }
}

export function buildAuthorizeUrl(
  config: Pick<GithubOAuthConfig, "clientId" | "redirectUri">,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

interface GithubTokenResponseBody {
  access_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
}

/**
 * GitHub's token endpoint defaults to form-encoded; `Accept: application/json`
 * gets a JSON body back instead, mirroring Linear's response shape. GitHub
 * also, unlike Linear, can return HTTP 200 with an `error` field in the body
 * rather than a non-2xx status — both are checked.
 */
async function postTokenRequest(body: Record<string, string>, isRefresh: boolean): Promise<GithubTokenResponseBody> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
  });

  const parsed = (await response.json().catch(() => null)) as GithubTokenResponseBody | null;

  if (!response.ok || !parsed?.access_token || parsed.error) {
    throw new GithubOAuthError(`GitHub OAuth token request failed with status ${response.status}`, {
      status: response.status,
      code: parsed?.error,
      // GitHub rejects an expired, revoked, or already-used refresh token
      // with `bad_refresh_token`. Only that means the user must reconnect.
      requiresReauth: isRefresh && parsed?.error === "bad_refresh_token",
    });
  }

  return parsed;
}

/**
 * A GitHub App with "Expire user authorization tokens" on (GitHub's default)
 * returns an 8-hour access token plus a single-use refresh token. With it off,
 * or for a legacy OAuth App token, neither field is present and the token
 * never expires.
 */
function toCredentials(body: GithubTokenResponseBody): GithubTokenCredentials {
  const credentials: GithubTokenCredentials = {
    accessToken: body.access_token as string,
    tokenType: body.token_type ?? "bearer",
    scope: body.scope ?? "",
  };
  if (body.refresh_token) credentials.refreshToken = body.refresh_token;
  if (typeof body.expires_in === "number") credentials.expiresAt = Date.now() + body.expires_in * 1000;
  return credentials;
}

export async function exchangeCodeForToken(
  code: string,
  config: GithubOAuthConfig,
): Promise<GithubTokenCredentials> {
  const body = await postTokenRequest(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    },
    false,
  );
  return toCredentials(body);
}

/**
 * Exchanges a refresh token for a new access token. GitHub refresh tokens
 * are single-use: the response always carries a new one, and callers must
 * persist it or the integration will need reconnecting.
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: Pick<GithubOAuthConfig, "clientId" | "clientSecret">,
): Promise<GithubTokenCredentials> {
  const body = await postTokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    },
    true,
  );
  return toCredentials(body);
}
