import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import {
  addToBetaAllowlist,
  availabilityErrorStatus,
  isIntegrationProvider,
  parseReason,
} from "@/lib/admin-integration-availability";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/**
 * Adds an organization to a provider's Beta allowlist (N10, D33): `{ organizationId, reason }`.
 * 409 `already_listed`, or `rollout_blocked` when a provider under a rollout
 * block (Custom REST: N9.14-F1) is not Beta with an allowlist (D33-A1). Scoped
 * to the one organization; the provider's policy is untouched. Audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const { provider } = await params;
  if (!isIntegrationProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { organizationId?: unknown; reason?: unknown } | null;
  if (typeof body?.organizationId !== "string" || !body.organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }
  try {
    await addToBetaAllowlist(getPrismaClient(), {
      actorEmail: session!.user.email.toLowerCase(),
      provider,
      organizationId: body.organizationId,
      reason: parseReason(body.reason),
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const { status, body: errorBody } = availabilityErrorStatus(error);
    return NextResponse.json(errorBody, { status });
  }
}
