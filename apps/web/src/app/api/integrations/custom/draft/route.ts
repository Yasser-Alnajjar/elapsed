import { NextResponse } from "next/server";
import { DraftInputError, getDraft, saveDraft } from "@sla/custom-ticket";
import { failure, ownerGuard, readJson } from "@/lib/custom-provider/route-guard";

/**
 * The wizard's draft (N9.11). `GET` returns the configuration and WHICH secret
 * fields are set, never a secret. `PUT { config, secrets? }` saves it: secrets
 * are write-only, encrypted at once and bound to the organization and field.
 */
export async function GET() {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { prisma, organizationId } = guard.ctx;
  return NextResponse.json({ draft: await getDraft(prisma, organizationId) });
}

export async function PUT(request: Request) {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { prisma, organizationId } = guard.ctx;
  const body = await readJson(request);
  if (!body) return failure("invalid_request", 400);
  const secrets = body.secrets !== null && typeof body.secrets === "object" && !Array.isArray(body.secrets) ? (body.secrets as Record<string, unknown>) : undefined;
  try {
    return NextResponse.json({ draft: await saveDraft(prisma, organizationId, { config: body.config, secrets }) });
  } catch (error) {
    if (error instanceof DraftInputError) return failure(error.code, 400);
    throw error;
  }
}
