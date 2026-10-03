import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getPrismaClient,
  createOrResendInvitation,
  listPendingInvitations,
  EmailAlreadyRegisteredError,
  InvitationConflictError,
} from "@sla/db";
import { sendTransactionalEmail } from "@/lib/transactional-email";
import { buildInvitationEmail } from "@/lib/invitation-email";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { gateCreation } from "@/lib/entitlements";
import { errorMessage } from "@/lib/utils";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

/** Any signed-in member can view pending invitations; only an owner can send one (task 5.4). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const prisma = getPrismaClient();
  const invitations = await listPendingInvitations(prisma, session.user.organizationId);
  return NextResponse.json({
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // N6.3: a lapsed trial blocks a new invitation (D27); an over-limit plan only warns.
  const gate = await gateCreation(session.user.organizationId, "seats");
  if (!gate.proceed) return gate.response;

  const prisma = getPrismaClient();
  let result;
  try {
    result = await createOrResendInvitation(prisma, {
      organizationId: session.user.organizationId,
      invitedByUserId: session.user.id,
      email: parsed.data.email,
    });
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return NextResponse.json({ error: "This email already has an account" }, { status: 409 });
    }
    if (error instanceof InvitationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  try {
    await sendTransactionalEmail(
      buildInvitationEmail({ to: parsed.data.email, organizationName: result.organizationName, token: result.token }),
    );
  } catch (error) {
    // The invitation row was already created/rotated above — not rolled
    // back, since it's harmless and immediately retryable: clicking
    // "invite" again on the same email finds this same pending row and
    // resends it with a fresh token (createOrResendInvitation's own
    // resend path). Surfaced distinctly so the caller knows to retry
    // rather than assuming the email went out.
    console.error(JSON.stringify({ event: "invitation_email_send_failed", error: errorMessage(error) }));
    return NextResponse.json(
      { error: "The invitation was created but the email failed to send. Try inviting this email again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, resent: result.resent, ...(gate.warning && { entitlementWarning: gate.warning }) });
}
