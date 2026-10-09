import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  availabilityErrorStatus,
  isIntegrationProvider,
  parsePolicyChanges,
  previewAvailabilityImpact,
} from "@/lib/admin-integration-availability";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/**
 * Read-only impact preview for a proposed change (N10, plan 10 §7): which
 * connected organizations would lose access. Body: the proposed policy
 * fields, or `{ removeOrganizationId }` for an allowlist removal. Writes nothing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const { provider } = await params;
  if (!isIntegrationProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const policy = parsePolicyChanges(body ?? {});
    const removeOrganizationId = typeof body?.removeOrganizationId === "string" ? body.removeOrganizationId : undefined;
    return NextResponse.json(await previewAvailabilityImpact(getPrismaClient(), provider, { policy, removeOrganizationId }));
  } catch (error) {
    const { status, body: errorBody } = availabilityErrorStatus(error);
    return NextResponse.json(errorBody, { status });
  }
}
