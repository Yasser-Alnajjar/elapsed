import { NextResponse } from "next/server";
import { seedDraftFromActive } from "@sla/custom-ticket";
import { failure, ownerGuard } from "@/lib/custom-provider/route-guard";

/** Starts a draft from the active configuration (credentials carried over, never returned) so it can be edited as a new version. */
export async function POST() {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const draft = await seedDraftFromActive(guard.ctx.prisma, guard.ctx.organizationId);
  return draft ? NextResponse.json({ draft }) : failure("not_connected", 404);
}
