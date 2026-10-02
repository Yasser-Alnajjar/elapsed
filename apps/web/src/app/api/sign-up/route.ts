import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createEmailVerificationToken, getPrismaClient, TRIAL_LENGTH_DAYS } from "@sla/db";
import { signUpSchema } from "@/lib/sign-up";
import { sendTransactionalEmail } from "@/lib/transactional-email";
import { buildEmailVerificationEmail } from "@/lib/email-verification-email";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { organizationName, email, password, fullName, acceptedTerms } =
    parsed.data;
  const prisma = getPrismaClient();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const organization = await prisma.organization.create({
    data: {
      name: organizationName,
      // The 14-day trial the pricing page promises. Informational until the operator turns entitlements on (N6.4).
      trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000),
      // Sign-up creates the owner directly; every invitation accepted
      // (roadmap 5.2) creates a `member` on an existing organization instead.
      users: {
        create: {
          email,
          passwordHash,
          role: "owner",
          name: fullName || null,
          acceptedTermsAt: acceptedTerms ? new Date() : null,
        },
      },
    },
    include: { users: true },
  });

  // Not awaited — sign-up itself doesn't gate on verification (the caller
  // signs in and reaches the dashboard immediately either way; see the
  // Profile page's "unverified" banner for how a user later confirms this),
  // so a slow or unreachable deployment SMTP server has no business making
  // account creation itself slow or fail. Logged on failure only.
  const user = organization.users[0]!;
  createEmailVerificationToken(prisma, user.id)
    .then(({ token }) => sendTransactionalEmail(buildEmailVerificationEmail({ to: email, token })))
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: "signup_verification_email_send_failed", error: errorMessage(error) }));
    });

  return NextResponse.json({ ok: true });
}
