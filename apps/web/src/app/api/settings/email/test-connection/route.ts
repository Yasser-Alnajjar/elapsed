import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { SmtpDestinationNotAllowedError, verifyEmailConfig } from "@sla/email";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { emailSettingsInputSchema, resolveTestPassword, smtpErrorMessage } from "@/lib/email-settings";

/**
 * Authenticates against the SMTP server the request describes, without
 * saving anything — lets the settings form validate credentials before
 * "Save Configuration" is pressed. `password` is optional in the request
 * body: the form never re-populates a saved password (see
 * `EmailNotificationsCard`), so a blank password here falls back to the
 * organization's already-saved one, letting an admin test after editing
 * only the host/port/etc.
 *
 * Only ever performs an SMTP handshake (never returns response bodies or
 * proxies arbitrary content back to the caller) — not a general-purpose
 * network probe, just enough surface to say "did this authenticate".
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = emailSettingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const resolved = await resolveTestPassword(prisma, session.user.organizationId, parsed.data);
  if ("error" in resolved) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  }
  const { password } = resolved;

  try {
    await verifyEmailConfig(
      {
        host: parsed.data.host,
        port: parsed.data.port,
        security: parsed.data.security,
        user: parsed.data.username,
        password,
        from: parsed.data.fromEmail,
        fromName: parsed.data.fromName ?? null,
      },
      { publicDestinationOnly: true },
    );
  } catch (error) {
    if (error instanceof SmtpDestinationNotAllowedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: smtpErrorMessage(error, password) }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message: "Connected and authenticated with the SMTP server." });
}
