import { NextResponse } from "next/server";
import { disconnectCustom } from "@/lib/custom-provider/activation";
import { failure, ownerGuard } from "@/lib/custom-provider/route-guard";

/**
 * Soft-disconnects Custom REST: credentials cleared, status `disconnected`,
 * rows and configuration versions kept (the raw-event log cascades on delete).
 * The worker skips disconnected integrations, so polling stops on its next tick.
 */
export async function POST() {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const done = await disconnectCustom(guard.ctx.prisma, guard.ctx.organizationId);
  return done ? NextResponse.json({ status: "disconnected" }) : failure("not_connected", 404);
}
