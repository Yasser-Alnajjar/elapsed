import { randomBytes } from "node:crypto";
import {
  ConnectLinkError,
  getPrismaClient,
  isConnectLinkProvider,
  resolveConnectLinkById,
  type ConnectLinkProvider,
  type ValidConnectLink,
} from "@sla/db";
import { getAppUrl } from "@/lib/app-url";
import { signOAuthState, verifyOAuthState, type DecodedOAuthState } from "@/lib/oauth-state";

/**
 * Connect links (N5.3, D26): a signed, expiring, single-use, organization- and
 * provider-scoped hand-off that lets a tracker admin who is not an Elapsed
 * member finish ONE OAuth grant. It reuses the OAuth `state` signing; the only
 * difference is that `state` carries `connectLinkId` instead of a user session.
 */
export const CONNECT_LINK_USER_PREFIX = "connect-link:";

export function connectLinkUrl(token: string): string {
  return new URL(`/connect/${token}`, getAppUrl()).toString();
}

export function signConnectLinkState(link: ValidConnectLink): string {
  return signOAuthState({
    nonce: randomBytes(16).toString("hex"),
    organizationId: link.organizationId,
    userId: `${CONNECT_LINK_USER_PREFIX}${link.id}`,
    connectLinkId: link.id,
    provider: link.provider,
  });
}

type Prisma = ReturnType<typeof getPrismaClient>;

export type LinkCallbackAuthorization =
  | { ok: true; state: DecodedOAuthState; link: ValidConnectLink }
  | { ok: false; status: 400 | 403 | 410; error: string };

/**
 * Callback-side check for a request with no signed-in session. The state must
 * match its cookie, carry a valid signature, and name a link that is still
 * usable and belongs to exactly this organization and provider.
 */
export async function authorizeConnectLinkCallback(
  prisma: Prisma,
  params: { returnedState: string | null; cookieState: string | null | undefined; provider: ConnectLinkProvider },
): Promise<LinkCallbackAuthorization> {
  const { returnedState, cookieState, provider } = params;
  if (!returnedState || !cookieState || returnedState !== cookieState) {
    return { ok: false, status: 400, error: "Invalid or expired OAuth state" };
  }
  const state = verifyOAuthState(cookieState);
  if (!state || typeof state.connectLinkId !== "string" || !isConnectLinkProvider(state.provider)) {
    return { ok: false, status: 400, error: "Invalid or expired OAuth state" };
  }
  if (state.provider !== provider) return { ok: false, status: 403, error: "Provider mismatch" };
  try {
    const link = await resolveConnectLinkById(prisma, state.connectLinkId);
    if (link.organizationId !== state.organizationId || link.provider !== provider) {
      return { ok: false, status: 403, error: "Organization mismatch" };
    }
    return { ok: true, state, link };
  } catch (error) {
    if (error instanceof ConnectLinkError) return { ok: false, status: 410, error: error.message };
    throw error;
  }
}

/** True when the callback's state cookie was minted by a connect link rather than a signed-in owner. */
export function isConnectLinkState(cookieState: string | null | undefined): boolean {
  if (!cookieState) return false;
  const state = verifyOAuthState(cookieState);
  return state !== null && typeof state.connectLinkId === "string";
}
