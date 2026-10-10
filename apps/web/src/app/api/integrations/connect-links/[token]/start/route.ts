import { NextResponse } from "next/server";
import { ConnectLinkError, getPrismaClient, resolveConnectLink, resolveIntegrationAvailability } from "@sla/db";
import { buildAuthorizeUrl as buildJiraAuthorizeUrl } from "@sla/jira";
import { buildAuthorizeUrl as buildLinearAuthorizeUrl } from "@sla/linear";
import { getJiraOAuthConfig, JIRA_STATE_COOKIE } from "@/lib/jira-env";
import { getLinearOAuthConfig, LINEAR_STATE_COOKIE } from "@/lib/linear-env";
import { signConnectLinkState } from "@/lib/connect-link";
import { getAppUrl } from "@/lib/app-url";

/**
 * Public, no session: the unguessable token is the credential. Starts the
 * provider's OAuth for exactly the link's organization and provider. The link
 * is NOT consumed here; only a completed callback consumes it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let link;
  try {
    link = await resolveConnectLink(getPrismaClient(), token);
  } catch (error) {
    if (error instanceof ConnectLinkError) {
      return NextResponse.redirect(new URL(`/connect/${encodeURIComponent(token)}`, getAppUrl()));
    }
    throw error;
  }

  // D33: the provider must be available to the link's organization. The link
  // page explains why not; the link is not consumed.
  if (!(await resolveIntegrationAvailability(getPrismaClient(), link.organizationId, link.provider)).available) {
    return NextResponse.redirect(new URL(`/connect/${encodeURIComponent(token)}`, getAppUrl()));
  }

  const state = signConnectLinkState(link);
  let authorizeUrl: string;
  let cookieName: string;
  try {
    if (link.provider === "jira") {
      authorizeUrl = buildJiraAuthorizeUrl(await getJiraOAuthConfig(link.organizationId), state);
      cookieName = JIRA_STATE_COOKIE;
    } else {
      authorizeUrl = buildLinearAuthorizeUrl(await getLinearOAuthConfig(link.organizationId), state);
      cookieName = LINEAR_STATE_COOKIE;
    }
  } catch {
    return NextResponse.json({ error: "This integration is not set up yet. Ask the person who sent you the link." }, { status: 500 });
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(cookieName, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
