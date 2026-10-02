import { randomBytes } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@sla/jira";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { blockedConnectRedirect, gateIntegrationConnect } from "@/lib/entitlements";
import { getJiraOAuthConfig, JIRA_STATE_COOKIE } from "@/lib/jira-env";
import { signOAuthState } from "@/lib/oauth-state";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  // N6.3: a lapsed trial blocks a new connection (D27); an over-limit plan only warns, on the admin tenant page.
  const gate = await gateIntegrationConnect(session.user.organizationId, "jira");
  if (!gate.proceed) return NextResponse.redirect(new URL(blockedConnectRedirect("jira"), request.url));

  let config;
  try {
    config = await getJiraOAuthConfig(session.user.organizationId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Jira OAuth is not configured" },
      { status: 500 },
    );
  }

  const nonce = randomBytes(16).toString("hex");
  const state = signOAuthState({ nonce, organizationId: session.user.organizationId, userId: session.user.id });

  const response = NextResponse.redirect(buildAuthorizeUrl(config, state));
  response.cookies.set(JIRA_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
