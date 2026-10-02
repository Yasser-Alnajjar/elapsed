import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  AdminConflictError,
  AdminNotFoundError,
  controlIntegration,
} from "@/lib/admin-tenant-mutations";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";
import { INTEGRATION_CONTROLS, type IntegrationControl } from "@/lib/types/admin";

/**
 * Operator controls for one integration (N4.5): `{ action }` is one of
 * `pause_polling`, `resume_polling`, `request_renormalize`. Platform operators
 * only, scoped to this integration, audited. None of them edits tenant data.
 */
export async function POST(request: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const { integrationId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !(INTEGRATION_CONTROLS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: `action must be one of: ${INTEGRATION_CONTROLS.join(", ")}` }, { status: 400 });
  }

  try {
    await controlIntegration(getPrismaClient(), {
      actorEmail: session!.user.email.toLowerCase(),
      integrationId,
      action: action as IntegrationControl,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof AdminConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
