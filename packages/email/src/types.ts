/**
 * Tri-state SMTP security, mirroring @sla/db's `EmailSecurity` — kept as a
 * distinct local type (rather than importing @sla/db here) so this package
 * stays a plain Nodemailer wrapper with no dependency on the DB layer.
 * "starttls" negotiates encryption after a plaintext connect (`secure:
 * false`, the normal choice on port 587); "ssl_tls" is implicit encryption
 * from the first byte (`secure: true`, the normal choice on port 465);
 * "none" sends over an unencrypted connection with no STARTTLS upgrade
 * attempted at all. Never inferred from the port — operators run any of the
 * three on any port.
 */
export type EmailSecurity = "none" | "starttls" | "ssl_tls";

/** Per-organization SMTP credentials, resolved by the caller (decrypted from `OrganizationEmailSettings`). */
export interface EmailConfig {
  host: string;
  port: number;
  security: EmailSecurity;
  user: string;
  password: string;
  from: string;
  fromName?: string | null;
}

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  /** Optional HTML body. Nodemailer sends a multipart message when both `text` and `html` are set, so `text` stays the guaranteed fallback for clients that can't render HTML. */
  html?: string;
  /** Files sent with the message, from memory: the content is the whole file, never a path or URL. */
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}
