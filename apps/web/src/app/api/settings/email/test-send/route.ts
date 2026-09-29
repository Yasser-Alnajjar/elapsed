import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { SmtpDestinationNotAllowedError, sendEmail } from "@sla/email";
import { DEFAULT_EMAIL_BRAND_NAME, renderNotificationEmailHtml } from "@sla/notifications";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { emailSettingsInputSchema, resolveTestPassword, smtpErrorMessage } from "@/lib/email-settings";

/**
 * Sends a real message through the SMTP server the request describes, to
 * the currently signed-in user — distinct from `test-connection` because
 * authentication succeeding is not proof delivery will (a relay can accept
 * a login and still reject or silently drop the actual send). Same
 * password-fallback rule as `test-connection`: a blank password in the
 * request body falls back to the organization's already-saved one.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;
  if (!session.user.email) {
    return NextResponse.json({ ok: false, error: "Your account has no email address to send a test to." }, { status: 400 });
  }

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

  const config = {
    host: parsed.data.host,
    port: parsed.data.port,
    security: parsed.data.security,
    user: parsed.data.username,
    password,
    from: parsed.data.fromEmail,
    fromName: parsed.data.fromName ?? null,
  };

  const brandName = config.fromName?.trim() || DEFAULT_EMAIL_BRAND_NAME;

  try {
    await sendEmail(config, {
      to: [session.user.email],
      subject: "SLA Breach Monitoring — Test Email",
      text: "This is a test email confirming your SMTP configuration for SLA Breach Monitoring is working correctly.\n\nIf you received this, at-risk and breach alerts will be delivered to this organization's users the same way, using this branding.",
      html: renderNotificationEmailHtml({
        brandName,
        severity: "at_risk",
        heading: "Test email",
        ticketLabel: "#0000",
        customerName: "Sample Customer",
        detailLine:
          "This is a test email confirming your SMTP configuration is working correctly. If you received this, at-risk and breach alerts will be delivered to this organization's users with this same branding.",
      }),
    }, { publicDestinationOnly: true });
  } catch (error) {
    if (error instanceof SmtpDestinationNotAllowedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: smtpErrorMessage(error, password) }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message: `Test email sent to ${session.user.email}.` });
}
