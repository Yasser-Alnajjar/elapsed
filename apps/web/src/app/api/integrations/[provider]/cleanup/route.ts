import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { cleanupIntegrationData, getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { isIntegrationProvider } from "@/lib/types/integrations";

/**
 * Permanently removes the data one integration imported — a separate, explicit
 * action from `/disconnect`, which never deletes anything and never triggers
 * this. What is owned by the integration and what is kept because it is shared
 * is documented on `cleanupIntegrationData`. The integration row itself stays,
 * still `disconnected`. It never creates a backup; the Data page offers one
 * separately (`/export`). Recorded in the data-operation audit trail.
 *
 * The body must name the provider (`{ "confirm": "<provider>" }`): a stray or
 * replayed POST without that explicit intent is a 400, not a deletion.
 * Refused with 409 unless the integration is disconnected.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const { provider } = await params;
  if (!isIntegrationProvider(provider)) {
    return NextResponse.json({ error: "Unknown integration" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== provider) {
    return NextResponse.json({ error: "Confirm the cleanup by naming the integration" }, { status: 400 });
  }

  const result = await cleanupIntegrationData(getPrismaClient(), session.user.organizationId, provider, {
    userId: session.user.id,
    email: session.user.email,
  });

  if (result.status === "not_found") {
    return NextResponse.json({ error: "This integration has no data to clean up" }, { status: 404 });
  }
  if (result.status === "not_disconnected") {
    return NextResponse.json(
      { error: "Disconnect this integration before cleaning up its data" },
      { status: 409 },
    );
  }

  return NextResponse.json({ status: "cleaned", counts: result.counts });
}
