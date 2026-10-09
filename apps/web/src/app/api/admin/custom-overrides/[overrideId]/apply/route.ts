import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { OverrideError } from "@sla/custom-ticket";
import { getPrismaClient } from "@sla/db";
import { applyGuardOverride } from "@/lib/admin-tenant-mutations";
import { authOptions } from "@/lib/auth";
import { requireGuardOverrideOperator } from "@/lib/authz";

/**
 * Applies a support-assisted guard override (N9, plan 09 6.11). Needs the
 * separate guard-override permission, not just platform-operator status, AND the
 * organization owner's recorded authorization for this exact override. Audited
 * in `AdminAuditLog` and in the durable override record.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ overrideId: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requireGuardOverrideOperator(session);
  if (denied) return denied;

  const { overrideId } = await params;
  try {
    await applyGuardOverride(getPrismaClient(), { actorEmail: session!.user.email.toLowerCase(), overrideId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OverrideError) {
      return NextResponse.json({ error: error.code, code: error.code }, { status: error.code === "not_found" ? 404 : 409 });
    }
    throw error;
  }
}
