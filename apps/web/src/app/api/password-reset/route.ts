import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrismaClient, requestPasswordReset } from "@sla/db";
import { sendTransactionalEmail } from "@/lib/transactional-email";
import { buildPasswordResetEmail } from "@/lib/password-reset-email";
import { errorMessage } from "@/lib/utils";

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

/**
 * Public (see `apps/web/src/proxy.ts`'s `PUBLIC_API_PATHS`) — "forgot
 * password" request. Always responds `{ ok: true }`, whether or not the
 * email belongs to an account: a differing response body would make this a
 * user-enumeration oracle (same concern `auth.ts`'s `DUMMY_PASSWORD_HASH`
 * closes for sign-in, and `requestPasswordReset`'s own doc comment) — and
 * so would a differing *latency*, which is why the email send below is
 * deliberately not awaited: this app runs as a long-lived Node server (not
 * a function-per-request runtime that could kill the process the instant
 * the response is sent — see `docker-compose.prod.yml`), so the send still
 * completes after the response goes out, but a caller timing the request
 * can no longer distinguish "found, sending" from "not found" by how long
 * the SMTP round trip took.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const result = await requestPasswordReset(prisma, parsed.data.email);

  if (result) {
    // Not awaited — see doc comment above. The token was already issued by
    // `requestPasswordReset` above regardless of whether this send
    // succeeds; a failure here is logged only (a differing response would
    // itself reveal that this email has an account, unlike the invitation
    // flow's equivalent 502 in 5.2, which is an authenticated owner action
    // with nothing to hide).
    sendTransactionalEmail(buildPasswordResetEmail({ to: parsed.data.email, token: result.token })).catch(
      (error: unknown) => {
        console.error(JSON.stringify({ event: "password_reset_email_send_failed", error: errorMessage(error) }));
      },
    );
  }

  return NextResponse.json({ ok: true });
}
