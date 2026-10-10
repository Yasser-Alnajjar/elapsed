import { NextResponse } from "next/server";
import { getCustomStatus } from "@/lib/custom-provider/status";
import { ownerGuard } from "@/lib/custom-provider/route-guard";

/** The integration's sync states, recent runs and versions for the wizard and the integration page. Owner only. */
export async function GET() {
  const guard = await ownerGuard({ requireAvailable: false });
  if (!guard.ok) return guard.response;
  return NextResponse.json({ status: await getCustomStatus(guard.ctx.prisma, guard.ctx.organizationId) });
}
