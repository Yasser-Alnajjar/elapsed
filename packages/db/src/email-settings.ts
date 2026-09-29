import type { PrismaClient } from "../generated/prisma/client";
import { aesGcmDecrypt, aesGcmEncrypt, deriveEncryptionKey } from "./crypto";

/** Mirrors the `EmailSecurity` enum in schema.prisma. */
export type EmailSecurity = "none" | "starttls" | "ssl_tls";

export interface EmailSettingsInput {
  host: string;
  port: number;
  security: EmailSecurity;
  username: string;
  /** Optional on an update so the settings form can change other fields without re-pasting the password. Required to create the first row. */
  password?: string;
  fromEmail: string;
  fromName?: string | null;
}

/** Decrypted SMTP credentials, resolved for one organization — only ever read server-side to build a Nodemailer transporter, never returned from an API route. */
export interface EmailSettingsCredentials {
  host: string;
  port: number;
  security: EmailSecurity;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string | null;
}

/** Status-only read for the settings UI — everything but the password, which the UI only ever shows masked. */
export interface EmailSettingsStatus {
  configured: boolean;
  host: string | null;
  port: number | null;
  security: EmailSecurity | null;
  username: string | null;
  fromEmail: string | null;
  fromName: string | null;
  updatedAt: Date | null;
}

/**
 * Thrown by `getEmailSettings` when a row exists but its `password` can't be
 * decrypted (wrong/rotated `SMTP_ENCRYPTION_KEY`, or corrupted ciphertext) —
 * distinct from "not configured" (no row), which is a normal state and
 * returns `null` instead of throwing. The message is deliberately generic
 * and stable, mirroring `IntegrationConfigUnreadableError`: it's safe to
 * surface directly in a response, and never carries ciphertext, the
 * underlying crypto error, or a stack trace. `cause` keeps the real error
 * available for server-side logging only.
 */
export class EmailSettingsUnreadableError extends Error {
  constructor(cause: unknown) {
    super(
      "Email configuration is unavailable. Please re-enter the configuration.",
    );
    this.name = "EmailSettingsUnreadableError";
    this.cause = cause;
  }
}

/**
 * Thrown when a save or test names a different SMTP host or username than the
 * saved one but leaves the password blank. A blank password means "keep the
 * saved one", and that is only safe while it is still sent to the same place
 * under the same login: otherwise a stored credential could be pointed at a
 * server the caller controls (H-10 F-D).
 */
export class SmtpPasswordRequiredError extends Error {
  constructor() {
    super("Re-enter the SMTP password when you change the host or username.");
    this.name = "SmtpPasswordRequiredError";
  }
}

/**
 * Whether a blank password may fall back to the saved one: only when the host
 * (case-insensitive, ignoring a trailing dot) and the username are unchanged.
 * Port, security and from-address changes do not move the credential to a new
 * host, so they don't need it.
 */
export function savedPasswordApplies(
  saved: { host: string; username: string },
  input: { host: string; username: string },
): boolean {
  const norm = (host: string) => host.trim().toLowerCase().replace(/\.$/, "");
  return norm(saved.host) === norm(input.host) && saved.username.trim() === input.username.trim();
}

const ENCRYPTION_SALT = "elapsed/email-settings";

/**
 * Derives a stable AES-256 key from the dedicated SMTP_ENCRYPTION_KEY
 * secret — kept separate from INTEGRATION_CONFIG_ENCRYPTION_KEY/
 * NEXTAUTH_SECRET so rotating one never invalidates the others.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.SMTP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "SMTP_ENCRYPTION_KEY must be set to encrypt or decrypt email configuration",
    );
  }
  return deriveEncryptionKey(secret, ENCRYPTION_SALT);
}

export function encryptSmtpPassword(plaintext: string): string {
  return aesGcmEncrypt(getEncryptionKey(), plaintext);
}

export function decryptSmtpPassword(encoded: string): string {
  return aesGcmDecrypt(getEncryptionKey(), encoded);
}

/**
 * Resolves one organization's decrypted SMTP credentials — used only by the
 * notification pipeline (to build a Nodemailer transporter) and by the
 * test-connection/test-send API routes (to fall back to the saved password
 * when the settings form's password field was left blank). Returns null
 * when the organization hasn't configured email yet — a normal state, not
 * an error.
 */
export async function getEmailSettings(
  prisma: PrismaClient,
  organizationId: string,
): Promise<EmailSettingsCredentials | null> {
  const row = await prisma.organizationEmailSettings.findUnique({
    where: { organizationId },
  });

  if (!row) return null;

  try {
    return {
      host: row.host,
      port: row.port,
      security: row.security,
      username: row.username,
      password: decryptSmtpPassword(row.password),
      fromEmail: row.fromEmail,
      fromName: row.fromName,
    };
  } catch (error) {
    throw new EmailSettingsUnreadableError(error);
  }
}

/** Status-only read for the settings UI — never decrypts or exposes the password. */
export async function getEmailSettingsStatus(
  prisma: PrismaClient,
  organizationId: string,
): Promise<EmailSettingsStatus> {
  const row = await prisma.organizationEmailSettings.findUnique({
    where: { organizationId },
    select: {
      host: true,
      port: true,
      security: true,
      username: true,
      fromEmail: true,
      fromName: true,
      updatedAt: true,
    },
  });

  return row
    ? { configured: true, ...row }
    : {
        configured: false,
        host: null,
        port: null,
        security: null,
        username: null,
        fromEmail: null,
        fromName: null,
        updatedAt: null,
      };
}

/**
 * Saves one organization's SMTP configuration. `password` is optional on an
 * update so the settings form can let an admin change the host/port/etc.
 * without having to re-paste a password it never echoes back.
 */
export async function saveEmailSettings(
  prisma: PrismaClient,
  organizationId: string,
  input: EmailSettingsInput,
): Promise<void> {
  const existing = await prisma.organizationEmailSettings.findUnique({
    where: { organizationId },
    select: { id: true, host: true, username: true },
  });

  if (!existing && !input.password) {
    throw new Error("Password is required to configure email notifications");
  }
  if (existing && !input.password && !savedPasswordApplies(existing, input)) {
    throw new SmtpPasswordRequiredError();
  }

  const fromName = input.fromName?.trim() || null;
  const encryptedPassword = input.password
    ? encryptSmtpPassword(input.password)
    : undefined;

  // Deliberately two separate calls rather than one `upsert`: Prisma
  // validates an `upsert`'s `create` *and* `update` argument shapes before
  // deciding which one to run against the DB, so a `create.password` of
  // `undefined` throws "Argument password is missing" even when the row
  // already exists and `update` (whose `password` is optional) is the one
  // that would actually execute. Branching here means each call only ever
  // sends the one shape Prisma needs to validate.
  if (existing) {
    await prisma.organizationEmailSettings.update({
      where: { organizationId },
      data: {
        host: input.host,
        port: input.port,
        security: input.security,
        username: input.username,
        ...(encryptedPassword ? { password: encryptedPassword } : {}),
        fromEmail: input.fromEmail,
        fromName,
      },
    });
  } else {
    await prisma.organizationEmailSettings.create({
      data: {
        organizationId,
        host: input.host,
        port: input.port,
        security: input.security,
        username: input.username,
        // Guaranteed defined here: the guard above throws when neither an
        // existing row nor a password is present, so reaching this branch
        // (no existing row) always has one.
        password: encryptedPassword as string,
        fromEmail: input.fromEmail,
        fromName,
      },
    });
  }
}
