import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient, revokeInvitation } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const { id } = await params;
  const prisma = getPrismaClient();
  await revokeInvitation(prisma, { organizationId: session.user.organizationId, invitationId: id });

  return NextResponse.json({ ok: true });
}
