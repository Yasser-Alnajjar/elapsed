import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { AdminNotFoundError, setCustomProviderFlag } from "@/lib/admin-tenant-mutations";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/**
 * Operator Beta flag for the Custom REST source (N9, plan 09 8.7): `{ enabled }`.
 * Platform operators only, audited. The flag gates the custom routes, UI and
 * activation; it never bypasses owner-only authorization or tenant isolation.
 */
export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const { organizationId } = await params;
  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

  try {
    const result = await setCustomProviderFlag(getPrismaClient(), {
      actorEmail: session!.user.email.toLowerCase(),
      organizationId,
      enabled: body.enabled,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
