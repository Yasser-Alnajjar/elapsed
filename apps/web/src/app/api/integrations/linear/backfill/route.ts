import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { LinearReauthRequiredError, runLinearBackfill, runLinearCorrelation, runLinearNormalization } from "@sla/linear";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { caseRefResolverFor } from "@/lib/case-ref";

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
    const correlation = await runLinearCorrelation(
      prisma,
      integration.id,
      await caseRefResolverFor(prisma, integration.organizationId),
    );
    const normalization = await runLinearNormalization(prisma, integration.id);
    return NextResponse.json({ backfill, correlation, normalization });
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
