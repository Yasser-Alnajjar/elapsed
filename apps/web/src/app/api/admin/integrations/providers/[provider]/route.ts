import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  availabilityErrorStatus,
  isIntegrationProvider,
  parseAvailabilityChange,
  updateIntegrationAvailability,
} from "@/lib/admin-integration-availability";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/**
 * Changes one provider's platform availability (N10, D33):
 * `{ expectedVersion, enabled?, releaseStage?, betaAccess?, statusMessage?, reason }`.
 * Compare-and-set on `expectedVersion` (409 `stale_version`); widening a
 * provider under a rollout block is 409 `rollout_blocked`. Audited.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const { provider } = await params;
  if (!isIntegrationProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  try {
    const input = parseAvailabilityChange(await request.json().catch(() => null));
    const result = await updateIntegrationAvailability(getPrismaClient(), {
      actorEmail: session!.user.email.toLowerCase(),
      provider,
      input,
    });
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = availabilityErrorStatus(error);
    return NextResponse.json(body, { status });
  }
}
