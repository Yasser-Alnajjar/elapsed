import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { exchangeCodeForToken } from "@sla/intercom";
import { encryptCredentials, getPrismaClient, type Prisma } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { getIntercomOAuthConfig, INTERCOM_STATE_COOKIE } from "@/lib/intercom-env";
import { validateOAuthState } from "@/lib/oauth-state";
import { getAppUrl } from "@/lib/app-url";
import { requireIntegrationAvailableOrRedirect } from "@/lib/integration-availability";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.redirect(new URL("/sign-in", getAppUrl()));
  const denied = requireOwner(session);
  if (denied) return denied;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const cookieState = request.headers
    .get("cookie")
    ?.split("; ")
    .find((entry) => entry.startsWith(`${INTERCOM_STATE_COOKIE}=`))
    ?.slice(INTERCOM_STATE_COOKIE.length + 1);

  if (!code) {
    return NextResponse.json(
      { error: "Invalid or expired OAuth state" },
      { status: 400 },
    );
  }

  const validation = validateOAuthState({
    returnedState: url.searchParams.get("state"),
    cookieState,
    sessionOrganizationId: session.user.organizationId,
    sessionUserId: session.user.id,
  });
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status },
    );
  }
  const { state } = validation;

  // D33: an OAuth flow started before the provider became unavailable must not
  // complete. Checked before the code is exchanged, so no credentials are
  // stored and a connect link is not consumed.
  const unavailable = await requireIntegrationAvailableOrRedirect(state.organizationId, "intercom", getAppUrl());
  if (unavailable) return unavailable;

  const config = await getIntercomOAuthConfig(state.organizationId);
  const credentials = await exchangeCodeForToken(code, config);
  const encryptedCredentials = encryptCredentials(credentials);

  const prisma = getPrismaClient();
  await prisma.integration.upsert({
    where: {
      organizationId_provider: {
        organizationId: state.organizationId,
        provider: "intercom",
      },
    },
    create: {
      organizationId: state.organizationId,
      provider: "intercom",
      credentials: encryptedCredentials as unknown as Prisma.InputJsonValue,
    },
    // Reconnecting always clears any prior disconnected/reauth_required state
    // and stale sync error, whether this is a first connect or a reconnect.
    update: {
      credentials: encryptedCredentials as unknown as Prisma.InputJsonValue,
      status: "connected",
      disconnectedAt: null,
      lastSyncError: null,
    },
  });

  const destination = state.returnTo === "onboarding" ? "/onboarding?connected=intercom" : "/settings/integrations";
  const response = NextResponse.redirect(new URL(destination, getAppUrl()));
  response.cookies.delete(INTERCOM_STATE_COOKIE);
  return response;
}
