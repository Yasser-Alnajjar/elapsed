import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import {
  IntercomReauthRequiredError,
  runIntercomBackfill,
} from "@sla/intercom";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { requireIntegrationAvailable } from "@/lib/integration-availability";
import { projectAndEvaluateSourceSyncs } from "@/lib/source-sync";

export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;
  // D33: no import from a provider that is unavailable to this organization.
  const unavailable = await requireIntegrationAvailable(session.user.organizationId, "intercom");
  if (unavailable) return unavailable;

  const prisma = getPrismaClient();
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: {
        organizationId: session.user.organizationId,
        provider: "intercom",
      },
    },
  });

  if (!integration) {
    return NextResponse.json(
      { error: "Intercom is not connected" },
      { status: 404 },
    );
  }

  try {
    const backfill = await runIntercomBackfill(prisma, integration.id);
    // Projection, commitments, and evaluation — deferred while a concurrently
    // running tracker backfill hasn't finished (see projectAndEvaluateSourceSyncs).
    const { providers, commitments, evaluation, pendingProviders } = await projectAndEvaluateSourceSyncs(
      prisma,
      session.user.organizationId,
    );

    return NextResponse.json({
      backfill,
      normalization: providers.intercom?.normalization,
      jira: providers.jira,
      linear: providers.linear,
      commitments,
      evaluation,
      pendingProviders,
    });
  } catch (error) {
    if (error instanceof IntercomReauthRequiredError) {
      return NextResponse.json(
        { error: "Intercom needs to be reconnected", reauthRequired: true },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 502 },
    );
  }
}
