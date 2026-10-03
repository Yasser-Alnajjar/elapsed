import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getPrismaClient,
  updateMemberRole,
  removeMember,
  MemberNotFoundError,
  CannotRemoveSelfError,
  LastOwnerError,
} from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";

const roleSchema = z.object({ role: z.enum(["owner", "member"]) });

/**
 * Only an organization owner can change another member's role or remove
 * them (task 5.4's authorization audit). `updateMemberRole`/`removeMember`
 * still refuse an organization's last owner from being demoted or removed
 * (see `LastOwnerError`), and `removeMember` refuses self-removal outright
 * (see `CannotRemoveSelfError`) — both are correctness invariants on top of,
 * not instead of, the owner-only gate.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { id } = await params;
  const prisma = getPrismaClient();
  try {
    await updateMemberRole(prisma, { organizationId: session.user.organizationId, memberId: id, role: parsed.data.role });
  } catch (error) {
    if (error instanceof MemberNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof LastOwnerError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const { id } = await params;
  const prisma = getPrismaClient();
  try {
    await removeMember(prisma, {
      organizationId: session.user.organizationId,
      memberId: id,
      actingUserId: session.user.id,
    });
  } catch (error) {
    if (error instanceof MemberNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof CannotRemoveSelfError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof LastOwnerError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }

  return NextResponse.json({ ok: true });
}
