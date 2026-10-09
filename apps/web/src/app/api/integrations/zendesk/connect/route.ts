import { randomBytes } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@sla/zendesk";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { blockedConnectRedirect, gateIntegrationConnect } from "@/lib/entitlements";
import { requireIntegrationAvailableOrRedirect } from "@/lib/integration-availability";
import { getZendeskOAuthConfig, ZENDESK_STATE_COOKIE } from "@/lib/zendesk-env";
import { signOAuthState } from "@/lib/oauth-state";

const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/i;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  // D33: the provider must be enabled and available to this organization.
  const unavailable = await requireIntegrationAvailableOrRedirect(session.user.organizationId, "zendesk", request.url);
  if (unavailable) return unavailable;

  // N6.3: a lapsed trial blocks a new connection (D27); an over-limit plan only warns, on the admin tenant page.
  const gate = await gateIntegrationConnect(session.user.organizationId, "zendesk");
  if (!gate.proceed) return NextResponse.redirect(new URL(blockedConnectRedirect("zendesk"), request.url));

  const subdomain =
    new URL(request.url).searchParams.get("subdomain")?.trim() ?? "";
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    return NextResponse.json(
      { error: "Enter a valid Zendesk subdomain" },
      { status: 400 },
    );
  }

  let config;
  try {
    config = await getZendeskOAuthConfig(session.user.organizationId);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Zendesk OAuth is not configured",
      },
      { status: 500 },
    );
  }

  const nonce = randomBytes(16).toString("hex");
  const state = signOAuthState({
    nonce,
    subdomain,
    organizationId: session.user.organizationId,
    userId: session.user.id,
  });

  const response = NextResponse.redirect(
    buildAuthorizeUrl(subdomain, config, state),
  );

  response.cookies.set(ZENDESK_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
