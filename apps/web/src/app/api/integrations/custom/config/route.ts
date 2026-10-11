import { NextResponse } from "next/server";
import { deleteCustomConfiguration } from "@/lib/custom-provider/activation";
import { failure, ownerGuard } from "@/lib/custom-provider/route-guard";

/**
 * Deletes the configuration (draft and versions) of a disconnected Custom REST
 * source. Disconnecting never does this. A connected source is refused: it is
 * disconnected first. Configuration only: every case, SLA, event and raw event is kept.
 */
export async function DELETE() {
  const guard = await ownerGuard({ requireAvailable: false });
  if (!guard.ok) return guard.response;
  const result = await deleteCustomConfiguration(
    guard.ctx.prisma,
    guard.ctx.organizationId,
  );
  if (result === "connected") return failure("disconnect_first", 409);
  return NextResponse.json({ status: result });
}
