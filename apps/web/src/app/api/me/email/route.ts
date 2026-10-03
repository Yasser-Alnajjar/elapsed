import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { EmailAlreadyRegisteredError, createEmailChangeToken, getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { sendTransactionalEmail } from "@/lib/transactional-email";
import { buildEmailChangeVerificationEmail } from "@/lib/email-verification-email";
import {
  checkAuthThrottle,
  clearAuthThrottle,
  recordFailedAuthAttempt,
} from "@/lib/auth-throttle";
import { errorMessage } from "@/lib/utils";

const requestEmailChangeSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Enter a valid email address"),
  currentPassword: z.string().min(1, "Current password is required"),
});

/**
 * Request an email change (roadmap 5.6) — same "prove you're really the
 * account holder" bar as `/api/me/password`: requires the current
 * password, throttled the same way. Nothing on `User` changes here; the
 * new address only takes effect once its verification link (sent to
 * `newEmail`, never the current one) is clicked — see `verifyEmail`.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = requestEmailChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const throttleKey = `change-email:${session.user.id}`;
  const throttle = checkAuthThrottle(throttleKey);
  if (throttle.throttled) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${throttle.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    recordFailedAuthAttempt(throttleKey);
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }
  clearAuthThrottle(throttleKey);

  if (parsed.data.newEmail === user.email) {
    return NextResponse.json({ error: "That's already your email address" }, { status: 400 });
  }

  let result;
  try {
    result = await createEmailChangeToken(prisma, { userId: user.id, newEmail: parsed.data.newEmail });
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return NextResponse.json({ error: "This email already has an account" }, { status: 409 });
    }
    throw error;
  }

  try {
    await sendTransactionalEmail(
      buildEmailChangeVerificationEmail({ to: parsed.data.newEmail, token: result.token }),
    );
  } catch (error) {
    console.error(JSON.stringify({ event: "email_change_email_send_failed", error: errorMessage(error) }));
    return NextResponse.json(
      { error: "The request was recorded but the confirmation email failed to send. Try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
