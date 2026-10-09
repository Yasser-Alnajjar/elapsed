import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { getAdminIntegrationsData } from "@/lib/admin-integration-availability";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/** Every provider's availability, allowlist, connection counts and health (N10, D33). Platform operators only. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;
  return NextResponse.json(await getAdminIntegrationsData(getPrismaClient()));
}
