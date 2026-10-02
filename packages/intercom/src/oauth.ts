import type { IntercomCredentials } from "./types";

export interface IntercomOAuthConfig {
  clientId: string;
  clientSecret: string;
}

const AUTHORIZE_URL = "https://app.intercom.com/oauth";
const TOKEN_URL = "https://api.intercom.io/auth/eagle/token";

/** Structured OAuth failure from an authorization-code exchange. */
export class IntercomOAuthError extends Error {
  readonly status: number;

  constructor(message: string, options: { status: number }) {
    super(message);
    this.name = "IntercomOAuthError";
    this.status = options.status;
  }
}

/**
 * Unlike Zendesk/Jira/Linear, Intercom's OAuth app config has no redirect URI
 * request parameter at all — the redirect URI is registered once on the app
 * itself in Intercom's Developer Hub, not passed per-request. Read-only
 * access is a property of the app's requested permissions (configured in the
 * same Developer Hub), not a `scope` parameter here (Phase 10: stay read-only
 * in v1).
 */
/** Where read-only access is enforced for Intercom: the app's own permissions, not a request parameter. */
export const INTERCOM_ACCESS_NOTE =
  "Read-only access is set by the permissions of the Intercom app you register in the Developer Hub; Intercom takes no scope per request.";

export function buildAuthorizeUrl(
  config: Pick<IntercomOAuthConfig, "clientId">,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("state", state);
  return url.toString();
}

interface IntercomTokenResponseBody {
  token?: string;
  token_type?: string;
  error?: string;
}

/**
 * Intercom's token endpoint takes a JSON body (like Zendesk's, unlike
 * Linear's form-encoding) and returns the access token under `token`, not
 * `access_token`. No `redirect_uri` here either — same as the authorize step.
 */
export async function exchangeCodeForToken(
  code: string,
  config: IntercomOAuthConfig,
): Promise<IntercomCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  const parsed = (await response
    .json()
    .catch(() => null)) as IntercomTokenResponseBody | null;

  if (!response.ok || !parsed?.token) {
    throw new IntercomOAuthError(
      `Intercom OAuth token request failed with status ${response.status}`,
      {
        status: response.status,
      },
    );
  }

  return {
    accessToken: parsed.token,
    tokenType: parsed.token_type ?? "Bearer",
  };
}
