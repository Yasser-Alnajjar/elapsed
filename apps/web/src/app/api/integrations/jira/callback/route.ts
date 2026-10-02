import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { exchangeCodeForToken, generateWebhookSecret } from "@sla/jira";
import { connectLinkLabel, consumeConnectLink, encryptCredentials, getPrismaClient, type Prisma } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { getJiraOAuthConfig, JIRA_STATE_COOKIE } from "@/lib/jira-env";
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
    .find((entry) => entry.startsWith(`${JIRA_STATE_COOKIE}=`))
    ?.slice(JIRA_STATE_COOKIE.length + 1);

  // No session: the only other authority is a connect link (N5.3, D26), valid
  // for this organization and provider only and consumed below.
  let connectLink: { id: string; label: string } | null = null;
  let state: { organizationId: string };
  if (isConnectLinkState(cookieState)) {
    const linkAuth = await authorizeConnectLinkCallback(getPrismaClient(), {
      returnedState: url.searchParams.get("state"),
      cookieState,
      provider: "jira",
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

  const config = await getJiraOAuthConfig(state.organizationId);
  const credentials = await exchangeCodeForToken(code, config);

  const prisma = getPrismaClient();

  // Reconnecting to a *different* Jira site than the one already connected
  // is refused once any history exists (roadmap task 2.7) — same reasoning
  // as the Zendesk callback's own check (see its comment): the unique key
  // here is (organizationId, provider), not site, so a switch would
  // silently reuse the same Integration row while old and new issues can
  // collide by key under the same integration id. Unlike Zendesk's
  // subdomain (entered by the user before the OAuth redirect), the target
  // site is only known after the token exchange — Jira's authorize flow
  // doesn't ask for one upfront (see JiraCredentials's doc comment) — so
  // this check can only run here, after `exchangeCodeForToken`.
  const existingIntegration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: state.organizationId, provider: "jira" } },
  });
  if (existingIntegration) {
    const existingCloudId = (existingIntegration.credentials as { cloudId?: string; siteUrl?: string } | null)?.cloudId;
    if (existingCloudId && existingCloudId !== credentials.cloudId) {
      const hasHistory = await prisma.rawEvent.findFirst({
        where: { integrationId: existingIntegration.id },
        select: { id: true },
      });
      if (hasHistory) {
        const existingSiteUrl = (existingIntegration.credentials as { siteUrl?: string } | null)?.siteUrl ?? existingCloudId;
        return NextResponse.json(
          {
            error: `This organization is already connected to Jira site "${existingSiteUrl}" with existing issue history. Disconnect it first before connecting a different site ("${credentials.siteUrl}") — switching directly would risk mixing up issues between the two sites.`,
          },
          { status: 409 },
        );
      }
    }
  }

  const encryptedCredentials = encryptCredentials(credentials);

  // A connect link is spent exactly once, atomically, after the grant is known
  // good; the loser of a race stores nothing.
  if (connectLink) {
    const claimed = await consumeConnectLink(prisma, {
      id: connectLink.id,
      organizationId: state.organizationId,
      provider: "jira",
    });
    if (!claimed) {
      return NextResponse.json({ error: "This connect link has already been used or has expired" }, { status: 410 });
    }
  }


  await prisma.integration.upsert({
    where: { organizationId_provider: { organizationId: state.organizationId, provider: "jira" } },
    create: {
      organizationId: state.organizationId,
      provider: "jira",
      credentials: encryptedCredentials as unknown as Prisma.InputJsonValue,
      connectedBy: connectLink?.label ?? null,
      // Generated once, here, and never rotated on reconnect — see
      // Integration.webhookSecret's doc comment (roadmap step 20).
      webhookSecret: generateWebhookSecret(),
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

  // Integrations connected before webhook support shipped (or reconnected
  // before this fix) have `webhookSecret: null`. Backfill it here so
  // reconnect actually enables webhooks, as the settings UI already claims
  // it does. The `webhookSecret: null` predicate makes this safe under a
  // concurrent reconnect: Postgres re-evaluates it after the row lock
  // releases, so only the first writer's value sticks.
  await prisma.integration.updateMany({
    where: { organizationId: state.organizationId, provider: "jira", webhookSecret: null },
    data: { webhookSecret: generateWebhookSecret() },
  });

  const response = NextResponse.redirect(
    new URL(connectLink ? "/connect/done" : "/onboarding?connected=jira", getAppUrl()),
  );
  response.cookies.delete(JIRA_STATE_COOKIE);
  return response;
}
