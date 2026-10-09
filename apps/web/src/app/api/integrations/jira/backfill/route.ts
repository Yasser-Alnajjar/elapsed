import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { JiraReauthRequiredError, runJiraBackfill } from "@sla/jira";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { requireIntegrationAvailable } from "@/lib/integration-availability";
import { projectAndEvaluateSourceSyncs } from "@/lib/source-sync";
import { getJiraOAuthConfig } from "@/lib/jira-env";

export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;
  // D33: no import from a provider that is unavailable to this organization.
  const unavailable = await requireIntegrationAvailable(session.user.organizationId, "jira");
  if (unavailable) return unavailable;

  const prisma = getPrismaClient();
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId: session.user.organizationId, provider: "jira" },
    },
  });

  if (!integration) {
    return NextResponse.json({ error: "Jira is not connected" }, { status: 404 });
  }

  let config;
  try {
    config = await getJiraOAuthConfig(session.user.organizationId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Jira OAuth is not configured" },
      { status: 500 },
    );
  }

  try {
    const backfill = await runJiraBackfill(prisma, integration.id, config);
    // Correlation needs Zendesk's cases, so when this finishes first the
    // Zendesk route's own call re-projects Jira and evaluates instead.
    const { providers, commitments, evaluation, pendingProviders } = await projectAndEvaluateSourceSyncs(
      prisma,
      session.user.organizationId,
    );
    return NextResponse.json({
      backfill,
      correlation: providers.jira?.correlation,
      normalization: providers.jira?.normalization,
      zendesk: providers.zendesk,
      commitments,
      evaluation,
      pendingProviders,
    });
  } catch (error) {
    if (error instanceof JiraReauthRequiredError) {
      return NextResponse.json({ error: "Jira needs to be reconnected", reauthRequired: true }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 502 },
    );
  }
}
