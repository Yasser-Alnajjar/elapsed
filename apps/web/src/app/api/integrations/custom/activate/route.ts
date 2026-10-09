import { NextResponse } from "next/server";
import { activateDraft } from "@/lib/custom-provider/activation";
import { gateIntegrationConnect } from "@/lib/entitlements";
import { failure, ownerGuard, readJson } from "@/lib/custom-provider/route-guard";

export const maxDuration = 150;

/**
 * Activates the draft as a new immutable configuration version (owner only,
 * audited). Subject to the plan's connect entitlement like any integration.
 * `{ note?, confirmPreviewHash? }`: when the new version makes a commitment
 * kind unsupported for commitments that already exist, the first call answers
 * `409 needs_confirmation` with the dry-run, and nothing is changed until the
 * owner repeats the call with that preview's hash.
 */
export async function POST(request: Request) {
  const guard = await ownerGuard({ outbound: true });
  if (!guard.ok) return guard.response;
  const { prisma, organizationId, userId } = guard.ctx;
  try {
    const gate = await gateIntegrationConnect(organizationId, "custom");
    if (!gate.proceed) return gate.response;
    const body = (await readJson(request)) ?? {};
    const result = await activateDraft(prisma, {
      organizationId,
      userId,
      note: typeof body.note === "string" ? body.note : undefined,
      confirmPreviewHash: typeof body.confirmPreviewHash === "string" ? body.confirmPreviewHash : undefined,
    });
    switch (result.status) {
      case "activated":
        return NextResponse.json({ version: result.version, cancelled: result.cancelled, warning: gate.warning });
      case "needs_confirmation":
        return NextResponse.json({ error: "needs_confirmation", code: "needs_confirmation", impact: result.impact }, { status: 409 });
      case "invalid":
        return NextResponse.json({ error: "invalid", code: "invalid", issues: result.issues, diagnostics: result.diagnostics }, { status: 422 });
      case "not_ready":
        return failure(result.code, 409, { missing: result.missing });
      case "listing_too_large":
        return failure("listing_too_large", 422, { measurement: result.measurement });
      case "blocked":
        return failure(result.reason, 409);
      case "conflict":
        return failure("conflict", 409);
    }
  } finally {
    guard.ctx.release();
  }
}
