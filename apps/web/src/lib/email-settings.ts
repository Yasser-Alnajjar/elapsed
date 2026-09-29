import { z } from "zod";
import { NextResponse } from "next/server";
import {
  SmtpDestinationNotAllowedError,
  resolvePublicSmtpAddress,
  privateSmtpHostsAllowed,
} from "@sla/email";
import { getEmailSettings, savedPasswordApplies, type PrismaClient } from "@sla/db";

/**
 * Shared by the save route and the two test routes (Test Connection, Send
 * Test Email) — all three accept the same shape. `password` is optional
 * everywhere: on save it means "keep the existing password" on an update,
 * and on a test it means "use the already-saved password", since the
 * settings form never re-populates it once saved (see
 * `EmailNotificationsCard`). Port/security are intentionally not
 * cross-validated against each other beyond basic range checks — an
 * unusual combination (e.g. 465 + STARTTLS) is a real, supportable SMTP
 * configuration, not an input error, so the UI only warns about it.
 */
export const emailSecuritySchema = z.enum(["none", "starttls", "ssl_tls"]);

export const emailSettingsInputSchema = z.object({
  host: z.string().trim().min(1, "SMTP host is required").max(255),
  port: z.coerce.number().int("Port must be a whole number").min(1, "Port must be between 1 and 65535").max(65535, "Port must be between 1 and 65535"),
  security: emailSecuritySchema,
  username: z.string().trim().min(1, "Username is required").max(255),
  password: z
    .string()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
  fromEmail: z.string().trim().toLowerCase().email("Enter a valid from email address"),
  fromName: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type EmailSettingsInput = z.infer<typeof emailSettingsInputSchema>;

/**
 * Redacts a secret out of an error message before it's ever logged or
 * returned from an API route. Nodemailer error text doesn't normally
 * include the password, but the config passed to it is caller-supplied —
 * this is a defense-in-depth backstop, not the primary guarantee.
 */
export function redactSecret(message: string, secret: string | undefined): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

/**
 * Safe, generic message for an SMTP verify/send failure — never the raw
 * Nodemailer error, which can include the target host/port (fine) but
 * shouldn't be trusted to never echo back credentials.
 */
export function smtpErrorMessage(error: unknown, secret: string | undefined): string {
  const message = error instanceof Error ? error.message : "SMTP request failed";
  return redactSecret(message, secret).slice(0, 300);
}

/**
 * The password a test action should use. A password in the request wins. A
 * blank one falls back to the saved password ONLY when the host and username
 * are the saved ones, so a stored credential can never be sent to a host the
 * caller just typed (H-10 F-D). `null` means the caller must re-enter it.
 */
export async function resolveTestPassword(
  prisma: PrismaClient,
  organizationId: string,
  input: { host: string; username: string; password?: string },
): Promise<{ password: string } | { error: string; status: 400 }> {
  if (input.password) return { password: input.password };
  const saved = await getEmailSettings(prisma, organizationId).catch(() => null);
  if (!saved) return { error: "Enter the SMTP password to test the connection.", status: 400 };
  if (!savedPasswordApplies(saved, input)) {
    return { error: "Re-enter the SMTP password when you change the host or username.", status: 400 };
  }
  return { password: saved.password };
}

/**
 * Save-time check of the destination, so an owner gets the refusal when
 * configuring rather than on the first alert. The same check runs again on
 * every connection (see `@sla/email`'s `publicDestinationOnly`).
 */
export async function destinationRefusal(host: string): Promise<NextResponse | null> {
  if (privateSmtpHostsAllowed()) return null;
  try {
    await resolvePublicSmtpAddress(host);
    return null;
  } catch (error) {
    // Only a refusal for a non-public address blocks a save; a name that does
    // not resolve yet (DNS not set up) is allowed, and fails at send time.
    if (error instanceof SmtpDestinationNotAllowedError) {
      return error.reason === "private"
        ? NextResponse.json({ ok: false, error: error.message }, { status: 400 })
        : null;
    }
    throw error;
  }
}
