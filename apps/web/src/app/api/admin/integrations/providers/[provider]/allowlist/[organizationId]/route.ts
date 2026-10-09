import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  availabilityErrorStatus,
  isIntegrationProvider,
  parseReason,
  removeFromBetaAllowlist,
} from "@/lib/admin-integration-availability";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/**
 * Removes an organization from a provider's Beta allowlist (N10, D33): `{ reason }`.
 * Its connection and data are kept; for Custom REST polling is also paused
 * (plan 09 §8.7). 409 `not_listed`. Audited.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ provider: string; organizationId: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const { provider, organizationId } = await params;
  if (!isIntegrationProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  try {
    const result = await removeFromBetaAllowlist(getPrismaClient(), {
      actorEmail: session!.user.email.toLowerCase(),
      provider,
      organizationId,
      reason: parseReason(body?.reason),
    });
    return NextResponse.json(result);
  } catch (error) {
    const { status, body: errorBody } = availabilityErrorStatus(error);
    return NextResponse.json(errorBody, { status });
  }
}
