import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { exchangeCodeForToken, generateWebhookSecret } from "@sla/zendesk";
import { encryptCredentials, getPrismaClient, type Prisma } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { getZendeskOAuthConfig, ZENDESK_STATE_COOKIE } from "@/lib/zendesk-env";
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
    .find((entry) => entry.startsWith(`${ZENDESK_STATE_COOKIE}=`))
    ?.slice(ZENDESK_STATE_COOKIE.length + 1);

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
  const state = validation.state as unknown as { subdomain: string; organizationId: string };

  const prisma = getPrismaClient();

  // Reconnecting to a *different* Zendesk subdomain than the one already
  // connected is refused once any history exists (roadmap task 2.7): the
  // unique key here is (organizationId, provider), not subdomain, so a
  // switch would silently reuse the same Integration row while old and new
  // tickets can collide by numeric id — a reset of Integration.cursor alone
  // can't fix that collision risk, so this fails closed rather than
  // "fixing" it into corrupted history. A never-synced integration (no
  // RawEvent yet) has nothing to corrupt, so switching is allowed — same as
  // connecting fresh.
  const existingIntegration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: state.organizationId, provider: "zendesk" } },
  });
  if (existingIntegration) {
    const existingSubdomain = (existingIntegration.credentials as { subdomain?: string } | null)?.subdomain;
    if (existingSubdomain && existingSubdomain.toLowerCase() !== state.subdomain.toLowerCase()) {
      const hasHistory = await prisma.rawEvent.findFirst({
        where: { integrationId: existingIntegration.id },
        select: { id: true },
      });
      if (hasHistory) {
        return NextResponse.json(
          {
            error: `This organization is already connected to Zendesk subdomain "${existingSubdomain}" with existing ticket history. Disconnect it first before connecting a different subdomain ("${state.subdomain}") — switching directly would risk mixing up tickets between the two accounts.`,
          },
          { status: 409 },
        );
      }
    }
  }

  // D33: an OAuth flow started before the provider became unavailable must not
  // complete. Checked before the code is exchanged, so no credentials are
  // stored and a connect link is not consumed.
  const unavailable = await requireIntegrationAvailableOrRedirect(state.organizationId, "zendesk", getAppUrl());
  if (unavailable) return unavailable;

  const config = await getZendeskOAuthConfig(state.organizationId);
  const credentials = await exchangeCodeForToken(state.subdomain, code, config);
  const encryptedCredentials = encryptCredentials(credentials);

  await prisma.integration.upsert({
    where: { organizationId_provider: { organizationId: state.organizationId, provider: "zendesk" } },
    create: {
      organizationId: state.organizationId,
      provider: "zendesk",
      credentials: encryptedCredentials as unknown as Prisma.InputJsonValue,
      // Generated once, here, and never rotated on reconnect — see
      // Integration.webhookSecret's doc comment (roadmap step 20).
      webhookSecret: generateWebhookSecret(),
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

  // Integrations connected before webhook support shipped (or reconnected
  // before this fix) have `webhookSecret: null`. Backfill it here so
  // reconnect actually enables webhooks, as the settings UI already claims
  // it does. The `webhookSecret: null` predicate makes this safe under a
  // concurrent reconnect: Postgres re-evaluates it after the row lock
  // releases, so only the first writer's value sticks.
  await prisma.integration.updateMany({
    where: { organizationId: state.organizationId, provider: "zendesk", webhookSecret: null },
    data: { webhookSecret: generateWebhookSecret() },
  });

  const response = NextResponse.redirect(
    new URL("/onboarding?connected=zendesk", getAppUrl()),
  );
  response.cookies.delete(ZENDESK_STATE_COOKIE);
  return response;
}
