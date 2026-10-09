import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { runZendeskBackfill, ZendeskReauthRequiredError } from "@sla/zendesk";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { requireIntegrationAvailable } from "@/lib/integration-availability";
import { projectAndEvaluateSourceSyncs } from "@/lib/source-sync";
import { getZendeskOAuthConfig } from "@/lib/zendesk-env";

export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;
  // D33: no import from a provider that is unavailable to this organization.
  const unavailable = await requireIntegrationAvailable(session.user.organizationId, "zendesk");
  if (unavailable) return unavailable;

  const prisma = getPrismaClient();
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId: session.user.organizationId, provider: "zendesk" },
    },
  });

  if (!integration) {
    return NextResponse.json({ error: "Zendesk is not connected" }, { status: 404 });
  }

  let config;
  try {
    config = await getZendeskOAuthConfig(session.user.organizationId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Zendesk OAuth is not configured" },
      { status: 500 },
    );
  }

  try {
    const backfill = await runZendeskBackfill(prisma, integration.id, config);
    // Projection, commitments, and evaluation — deferred while a concurrently
    // running Jira backfill hasn't finished (see projectAndEvaluateSourceSyncs).
    const { providers, commitments, evaluation, pendingProviders } = await projectAndEvaluateSourceSyncs(
      prisma,
      session.user.organizationId,
    );
    return NextResponse.json({
      backfill,
      normalization: providers.zendesk?.normalization,
      jiraLinkCorrelation: providers.zendesk?.correlation,
      businessCalendarImport: providers.zendesk?.calendarImport,
      slaPolicyImport: providers.zendesk?.policyImport,
      jira: providers.jira,
      commitments,
      evaluation,
      pendingProviders,
    });
  } catch (error) {
    if (error instanceof ZendeskReauthRequiredError) {
      return NextResponse.json(
        { error: "Zendesk needs to be reconnected", reauthRequired: true },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 502 },
    );
  }
}
