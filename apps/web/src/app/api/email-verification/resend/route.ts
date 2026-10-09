import { NextResponse } from "next/server";
import { z } from "zod";
import { createEmailVerificationToken, getPrismaClient } from "@sla/db";
import { sendTransactionalEmail } from "@/lib/transactional-email";
import { tooManyAttemptsMessage } from "@/lib/auth-rate-limit";
import { buildEmailVerificationEmail } from "@/lib/email-verification-email";
import { checkRateLimit } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/utils";

const resendSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

/**
 * Public (see `apps/web/src/proxy.ts`'s `PUBLIC_API_PATHS`) — resend the
 * signup-verification email. Sign-in is blocked until an account's email is
 * verified, so the person who needs this has no session to authenticate a
 * request with (unlike `/api/me/resend-verification`, the session-gated
 * route this complements); the address itself is the only input.
 *
 * Always responds `{ ok: true }` whether or not the address belongs to an
 * account, or whether that account is already verified — a differing
 * response would make this a user-enumeration oracle, the same concern (and
 * the same answer) as `/api/password-reset`. For the same reason the token
 * issue + send happens after the response is decided and isn't awaited, so
 * response time doesn't distinguish "found, sending" from "not found". A
 * failed send is logged only; the caller can simply ask again.
 *
 * Throttled per address (here, before any lookup, so an unknown address
 * and a real one are limited identically) on top of the per-IP bucket in
 * `proxy.ts`: together they stop the route from being used to spam one
 * inbox from many IPs, or many inboxes from one IP. Requesting a new link
 * invalidates the previous unused one (`createEmailVerificationToken`).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = resendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { email } = parsed.data;

  const rateLimit = checkRateLimit(`resend-verification-public:${email}`, 3, 10 * 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: tooManyAttemptsMessage(rateLimit.retryAfterSeconds ?? 60),
        retryAfterSeconds: rateLimit.retryAfterSeconds ?? 60 },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } },
    );
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && !user.emailVerifiedAt) {
    createEmailVerificationToken(prisma, user.id)
      .then(({ token }) => sendTransactionalEmail(buildEmailVerificationEmail({ to: user.email, token })))
      .catch((error: unknown) => {
        console.error(JSON.stringify({ event: "resend_verification_email_send_failed", error: errorMessage(error) }));
      });
  }

  return NextResponse.json({ ok: true });
}
