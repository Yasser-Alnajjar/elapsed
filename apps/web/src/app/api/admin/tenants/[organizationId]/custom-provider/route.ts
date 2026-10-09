import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  addToBetaAllowlist,
  AvailabilityConflictError,
  parseReason,
  removeFromBetaAllowlist,
} from "@/lib/admin-integration-availability";
import { AdminNotFoundError, AdminValidationError } from "@/lib/admin-tenant-mutations";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/**
 * Legacy route for the Custom REST Beta flag (N9, plan 09 8.7): `{ enabled, reason }`.
 * Kept for one release (D33, plan 10 §7.1) as a thin wrapper over the Custom
 * REST Beta allowlist; new callers use `/api/admin/integrations/providers/custom/allowlist`.
 * Enabling is refused while the N9.14-F1 rollout block stands (409 `rollout_blocked`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const { organizationId } = await params;
  const body = (await request.json().catch(() => null)) as { enabled?: unknown; reason?: unknown } | null;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

  const actorEmail = session!.user.email.toLowerCase();
  const prisma = getPrismaClient();
  try {
    const reason = parseReason(body.reason);
    if (body.enabled) {
      await addToBetaAllowlist(prisma, { actorEmail, provider: "custom", organizationId, reason });
      return NextResponse.json({ changed: true, pausedPolling: false });
    }
    const { pausedPolling } = await removeFromBetaAllowlist(prisma, { actorEmail, provider: "custom", organizationId, reason });
    return NextResponse.json({ changed: true, pausedPolling });
  } catch (error) {
    if (error instanceof AdminValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof AdminNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof AvailabilityConflictError) {
      // A request that changes nothing writes nothing (the pre-D33 behavior).
      if (error.code === "already_listed" || error.code === "not_listed") return NextResponse.json({ changed: false, pausedPolling: false });
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }
}
