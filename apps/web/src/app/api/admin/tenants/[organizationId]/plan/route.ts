import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  AdminNotFoundError,
  AdminValidationError,
  parsePlanRecordInput,
  updatePlanRecord,
} from "@/lib/admin-tenant-mutations";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/**
 * Edit one organization's manual plan record (N4.3). Platform operators only
 * (`403` for everyone else, including an org owner), audited as `update_plan`.
 * Informational: nothing here changes how the organization is monitored.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const { organizationId } = await params;
  const body = await request.json().catch(() => null);

  try {
    const input = parsePlanRecordInput(body);
    const result = await updatePlanRecord(getPrismaClient(), {
      actorEmail: session!.user.email.toLowerCase(),
      organizationId,
      input,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof AdminNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
