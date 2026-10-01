import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { GithubReauthRequiredError, githubAdapter, runGithubBackfill } from "@sla/github";
import { getPrismaClient, withOrganizationSlaLock } from "@sla/db";
import { syncIntegration } from "@sla/ingestion";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { getGithubOAuthConfig } from "@/lib/github-env";

export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const prisma = getPrismaClient();
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId: session.user.organizationId, provider: "github" },
    },
  });

  if (!integration) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 404 });
  }

  let config;
  try {
    config = await getGithubOAuthConfig(session.user.organizationId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GitHub OAuth is not configured" },
      { status: 500 },
    );
  }

  try {
    const backfill = await runGithubBackfill(prisma, integration.id, config);
    // Correlation links through the trackers' links, then the PRs' events land
    // on those cases; both project under the organization lock, like the worker.
    const integrationRef = {
      id: integration.id,
      organizationId: integration.organizationId,
      provider: integration.provider,
      status: integration.status,
    };
    const { correlation, normalization } = await withOrganizationSlaLock(prisma, integration.organizationId, () =>
      syncIntegration(githubAdapter, { prisma, integration: integrationRef, mode: "full", resolveCaseRef: null }),
    );
    return NextResponse.json({ backfill, correlation, normalization });
  } catch (error) {
    if (error instanceof GithubReauthRequiredError) {
      return NextResponse.json({ error: "GitHub needs to be reconnected", reauthRequired: true }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 502 },
    );
  }
}
