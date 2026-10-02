import { randomBytes } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@sla/intercom";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { blockedConnectRedirect, gateIntegrationConnect } from "@/lib/entitlements";
import {
  getIntercomOAuthConfig,
  INTERCOM_STATE_COOKIE,
} from "@/lib/intercom-env";
import { signOAuthState } from "@/lib/oauth-state";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  // N6.3: a lapsed trial blocks a new connection (D27); an over-limit plan only warns, on the admin tenant page.
  const gate = await gateIntegrationConnect(session.user.organizationId, "intercom");
  if (!gate.proceed) return NextResponse.redirect(new URL(blockedConnectRedirect("intercom"), request.url));

  let config;
  try {
    config = await getIntercomOAuthConfig(session.user.organizationId);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Intercom OAuth is not configured",
      },
      { status: 500 },
    );
  }

  const nonce = randomBytes(16).toString("hex");
  // Onboarding starts the flow with `?returnTo=onboarding` so the callback
  // lands back in it; anything else returns to the settings page. Only this
  // fixed value is ever carried through the signed state — never a URL.
  const returnTo =
    new URL(request.url).searchParams.get("returnTo") === "onboarding"
      ? "onboarding"
      : undefined;
  const state = signOAuthState({
    nonce,
    organizationId: session.user.organizationId,
    userId: session.user.id,
    ...(returnTo ? { returnTo } : {}),
  });

  const response = NextResponse.redirect(buildAuthorizeUrl(config, state));
  response.cookies.set(INTERCOM_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
