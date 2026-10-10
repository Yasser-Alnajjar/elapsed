import { NextResponse } from "next/server";
import { rollbackToVersion } from "@/lib/custom-provider/activation";
import { failure, ownerGuard, readJson } from "@/lib/custom-provider/route-guard";

/**
 * Re-activates an earlier immutable version (owner only, audited). Future
 * processing only: commitments a later version cancelled are never
 * reactivated, and the dry-run says how many stay cancelled. Same
 * confirmation-by-hash flow as activation.
 */
export async function POST(request: Request) {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { prisma, organizationId, userId } = guard.ctx;
  const body = await readJson(request);
  const toVersion = body?.toVersion;
  if (typeof toVersion !== "number" || !Number.isInteger(toVersion) || toVersion < 1) return failure("invalid_request", 400);
  const result = await rollbackToVersion(prisma, {
    organizationId,
    userId,
    toVersion,
    confirmPreviewHash: typeof body?.confirmPreviewHash === "string" ? body.confirmPreviewHash : undefined,
  });
  switch (result.status) {
    case "activated":
      return NextResponse.json({ version: result.version, cancelled: result.cancelled });
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
}
