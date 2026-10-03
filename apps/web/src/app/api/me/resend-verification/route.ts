import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { createEmailVerificationToken, getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { sendTransactionalEmail } from "@/lib/transactional-email";
import { buildEmailVerificationEmail } from "@/lib/email-verification-email";
import { checkRateLimit } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/utils";

/**
 * Resend the signup-verification email for the signed-in user's own
 * (already-current) email (roadmap 5.6). No-op — still `ok: true` — if the
 * account is already verified, so the Profile page doesn't need to special
 * case a race against the user verifying in another tab first.
 *
 * Throttled with the same fixed-window counter `proxy.ts` uses for
 * unauthenticated routes, keyed by user id instead of IP — this route has
 * no failed/succeeded credentials check to hang `auth-throttle.ts`'s
 * *failed-attempt* semantics on (see that module's own doc comment), just
 * a plain "not too many clicks" limit.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const rateLimit = checkRateLimit(`resend-verification:${session.user.id}`, 3, 10 * 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rateLimit.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (user.emailVerifiedAt) return NextResponse.json({ ok: true });

  const { token } = await createEmailVerificationToken(prisma, user.id);
  try {
    await sendTransactionalEmail(buildEmailVerificationEmail({ to: user.email, token }));
  } catch (error) {
    console.error(JSON.stringify({ event: "resend_verification_email_send_failed", error: errorMessage(error) }));
    return NextResponse.json({ error: "Failed to send verification email. Try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
