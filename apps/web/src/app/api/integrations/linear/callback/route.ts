import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { exchangeCodeForToken } from "@sla/linear";
import { connectLinkLabel, consumeConnectLink, encryptCredentials, getPrismaClient, type Prisma } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { getLinearOAuthConfig, LINEAR_STATE_COOKIE } from "@/lib/linear-env";
import { validateOAuthState } from "@/lib/oauth-state";
import { authorizeConnectLinkCallback, isConnectLinkState } from "@/lib/connect-link";
import { getAppUrl } from "@/lib/app-url";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const cookieState = request.headers
    .get("cookie")
    ?.split("; ")
    .find((entry) => entry.startsWith(`${LINEAR_STATE_COOKIE}=`))
    ?.slice(LINEAR_STATE_COOKIE.length + 1);

  // No session: the only other authority is a connect link (N5.3, D26), valid
  // for this organization and provider only and consumed below.
  let connectLink: { id: string; label: string } | null = null;
  let state: { organizationId: string };
  if (isConnectLinkState(cookieState)) {
    const linkAuth = await authorizeConnectLinkCallback(getPrismaClient(), {
      returnedState: url.searchParams.get("state"),
      cookieState,
      provider: "linear",
    });
    if (!linkAuth.ok) return NextResponse.json({ error: linkAuth.error }, { status: linkAuth.status });
    if (!code) return NextResponse.json({ error: "Invalid or expired OAuth state" }, { status: 400 });
    connectLink = { id: linkAuth.link.id, label: connectLinkLabel(linkAuth.link) };
    state = linkAuth.state;
  } else {
    if (!session) return NextResponse.redirect(new URL("/sign-in", getAppUrl()));
    const denied = requireOwner(session);
    if (denied) return denied;
    if (!code) {
      return NextResponse.json({ error: "Invalid or expired OAuth state" }, { status: 400 });
    }
    const validation = validateOAuthState({
      returnedState: url.searchParams.get("state"),
      cookieState,
      sessionOrganizationId: session.user.organizationId,
      sessionUserId: session.user.id,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }
    state = validation.state;
  }

  const config = await getLinearOAuthConfig(state.organizationId);
  const credentials = await exchangeCodeForToken(code, config);
  const encryptedCredentials = encryptCredentials(credentials);

  const prisma = getPrismaClient();
  // A connect link is spent exactly once, atomically, after the grant is known
  // good; the loser of a race stores nothing.
  if (connectLink) {
    const claimed = await consumeConnectLink(prisma, {
      id: connectLink.id,
      organizationId: state.organizationId,
      provider: "linear",
    });
    if (!claimed) {
      return NextResponse.json({ error: "This connect link has already been used or has expired" }, { status: 410 });
    }
  }

  await prisma.integration.upsert({
    where: {
      organizationId_provider: {
        organizationId: state.organizationId,
        provider: "linear",
      },
    },
    create: {
      organizationId: state.organizationId,
      provider: "linear",
      credentials: encryptedCredentials as unknown as Prisma.InputJsonValue,
      connectedBy: connectLink?.label ?? null,
    },
    // Reconnecting always clears any prior disconnected/reauth_required state
    // and stale sync error, whether this is a first connect or a reconnect.
    update: {
      credentials: encryptedCredentials as unknown as Prisma.InputJsonValue,
      connectedBy: connectLink?.label ?? null,
      status: "connected",
      disconnectedAt: null,
      lastSyncError: null,
    },
  });

  const response = NextResponse.redirect(new URL(connectLink ? "/connect/done" : "/onboarding", getAppUrl()));
  response.cookies.delete(LINEAR_STATE_COOKIE);
  return response;
}
