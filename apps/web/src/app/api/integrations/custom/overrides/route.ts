import { NextResponse } from "next/server";
import { OverrideError, authorizeSupportOverride, confirmCustomerOverride, latestLifecycleAbort } from "@sla/custom-ticket";
import { failure, ownerGuard, readJson } from "@/lib/custom-provider/route-guard";

async function customIntegrationId(prisma: import("@sla/db").PrismaClient, organizationId: string): Promise<string | null> {
  const row = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: "custom" } }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * Guard override after a mass-lifecycle-change abort (plan 09, 6.11). Owner
 * only (U1). Only that guard can be overridden; a mass deletion never can.
 *
 * `GET` is the read-only preview of the aborted pass: counts, up to 20 record
 * ids and the hash that binds a confirmation to this exact record set.
 *
 * `POST { previewHash, reason, via? }` records a single-use, expiring
 * confirmation. `via: "support"` records the owner's AUTHORIZATION for a
 * platform operator with the separate permission to apply instead; the
 * operator cannot create or assert it.
 */
export async function GET() {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { prisma, organizationId } = guard.ctx;
  const integrationId = await customIntegrationId(prisma, organizationId);
  if (!integrationId) return failure("not_connected", 404);
  return NextResponse.json({ aborted: await latestLifecycleAbort(prisma, integrationId) });
}

export async function POST(request: Request) {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { prisma, organizationId, userId } = guard.ctx;
  const body = await readJson(request);
  if (!body || typeof body.previewHash !== "string" || typeof body.reason !== "string") return failure("invalid_request", 400);
  const integrationId = await customIntegrationId(prisma, organizationId);
  if (!integrationId) return failure("not_connected", 404);
  try {
    const input = { organizationId, integrationId, userId, previewHash: body.previewHash, reason: body.reason };
    const result = body.via === "support" ? await authorizeSupportOverride(prisma, input) : await confirmCustomerOverride(prisma, input);
    return NextResponse.json({ id: result.id, expiresAt: result.expiresAt.toISOString(), via: body.via === "support" ? "support" : "customer" });
  } catch (error) {
    if (error instanceof OverrideError) return failure(error.code, error.code === "no_aborted_pass" || error.code === "stale_preview" ? 409 : 400);
    throw error;
  }
}
