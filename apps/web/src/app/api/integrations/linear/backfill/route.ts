import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { LinearReauthRequiredError, runLinearBackfill } from "@sla/linear";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { projectAndEvaluateSourceSyncs } from "@/lib/source-sync";

export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const prisma = getPrismaClient();
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId: session.user.organizationId, provider: "linear" },
    },
  });

  if (!integration) {
    return NextResponse.json({ error: "Linear is not connected" }, { status: 404 });
  }

  try {
    const backfill = await runLinearBackfill(prisma, integration.id);
    // Correlation needs the ticket source's cases, so when this finishes first
    // the ticket source's own backfill call re-projects Linear and evaluates.
    const { linear, commitments, evaluation, pendingProviders } = await projectAndEvaluateSourceSyncs(
      prisma,
      session.user.organizationId,
    );
    return NextResponse.json({
      backfill,
      correlation: linear?.correlation,
      normalization: linear?.normalization,
      commitments,
      evaluation,
      pendingProviders,
    });
  } catch (error) {
    if (error instanceof LinearReauthRequiredError) {
      return NextResponse.json({ error: "Linear needs to be reconnected", reauthRequired: true }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 502 },
    );
  }
}
