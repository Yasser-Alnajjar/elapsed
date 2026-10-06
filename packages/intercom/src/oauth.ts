import type { IntercomCredentials } from "./types";

export interface IntercomOAuthConfig {
  clientId: string;
  clientSecret: string;
  /**
   * Sent on the authorize request so Intercom redirects back to this
   * deployment. Optional: when omitted, Intercom falls back to the first
   * Redirect URL saved on the app in the Developer Hub.
   */
  redirectUri?: string;
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
 * Intercom accepts an optional `redirect_uri` on the authorize request, which
 * must match one of the Redirect URLs registered on the app in the Developer
 * Hub. Without it Intercom uses the *first* registered URL, so a deployment
 * must send its own or it is redirected to whichever URL (e.g. localhost) is
 * listed first. Read-only access is a property of the app's requested
 * permissions (configured in the same Developer Hub), not a `scope` parameter
 * here (Phase 10: stay read-only in v1).
 */
/** Where read-only access is enforced for Intercom: the app's own permissions, not a request parameter. */
export const INTERCOM_ACCESS_NOTE =
  "Read-only access is set by the permissions of the Intercom app you register in the Developer Hub; Intercom takes no scope per request.";

export function buildAuthorizeUrl(
  config: Pick<IntercomOAuthConfig, "clientId" | "redirectUri">,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  if (config.redirectUri) url.searchParams.set("redirect_uri", config.redirectUri);
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
 * `access_token`. The token request takes no `redirect_uri`.
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
