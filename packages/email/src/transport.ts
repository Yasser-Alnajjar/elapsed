import nodemailer, { type Transporter } from "nodemailer";
import { privateSmtpHostsAllowed, resolvePublicSmtpAddress } from "./destination";
import { assertRendered, type RenderedEmail } from "./rendered";
import type { EmailAttachment, EmailConfig } from "./types";

/** Generous enough for a slow SMTP relay, short enough that a settings-form "Test Connection" click (or a misconfigured/unreachable host) fails fast instead of hanging the request. */
const CONNECTION_TIMEOUT_MS = 10_000;

/**
 * The SMTP transport: delivery only. It is private to this package (nothing
 * here is re-exported except `verifyEmailConfig`, which sends nothing) and
 * accepts only a `RenderedEmail`, so presentation is never its concern and
 * every message that reaches it has been through the Elapsed layout.
 *
 * Every other integration in this monorepo is a zero-dependency `fetch`
 * client (see `@sla/slack`), but SMTP is a stateful line-based protocol
 * `fetch` cannot speak — nodemailer is the one external dependency this
 * package carries for that reason. A transporter is created per call rather
 * than pooled/reused: the worker calls this at most once per notification
 * candidate per cycle, and the settings UI's test actions are one-shot, so
 * connection reuse isn't worth the added state.
 *
 * `security` maps onto Nodemailer's own options rather than the port —
 * see `EmailSecurity`'s doc comment for why the port is never used to infer
 * it.
 */
function createTransporter(config: EmailConfig, connectHost: string = config.host): Transporter {
  const base = {
    host: connectHost,
    port: config.port,
    // Connecting to a resolved address (see `SendOptions.publicDestinationOnly`)
    // must still validate the certificate against the name the customer typed.
    ...(connectHost !== config.host ? { tls: { servername: config.host } } : {}),
    auth: { user: config.user, pass: config.password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: CONNECTION_TIMEOUT_MS,
  };

  switch (config.security) {
    case "ssl_tls":
      return nodemailer.createTransport({ ...base, secure: true });
    case "none":
      return nodemailer.createTransport({ ...base, secure: false, ignoreTLS: true });
    case "starttls":
    default:
      return nodemailer.createTransport({ ...base, secure: false });
  }
}

export interface SendOptions {
  /**
   * Set for SMTP settings that an organization owner typed in. The host is
   * resolved first and the connection is refused unless every address is a
   * public one (throws `SmtpDestinationNotAllowedError`); the connection then
   * goes to the resolved address. Leave unset for operator-configured SMTP
   * (deployment env, ops alerts). `SMTP_ALLOW_PRIVATE_HOSTS=1` turns the check
   * off for local development.
   */
  publicDestinationOnly?: boolean;
}

async function connectHostFor(config: EmailConfig, options: SendOptions): Promise<string> {
  if (!options.publicDestinationOnly || privateSmtpHostsAllowed()) return config.host;
  return resolvePublicSmtpAddress(config.host);
}

function fromHeader(config: EmailConfig): string {
  return config.fromName ? `"${config.fromName.replace(/"/g, "'")}" <${config.from}>` : config.from;
}

/**
 * Authenticates against the configured SMTP server without sending
 * anything — the "Test Connection" action in the settings UI, and cheap
 * enough to also run before a real send if a caller wants to fail fast.
 * Deliberately separate from `sendEmail`: authentication succeeding is not
 * proof message delivery will (a relay can accept a login and still reject
 * or silently drop the actual send).
 */
export async function verifyEmailConfig(config: EmailConfig, options: SendOptions = {}): Promise<void> {
  const transporter = createTransporter(config, await connectHostFor(config, options));
  await transporter.verify();
}

export interface Delivery {
  to: readonly string[];
  email: RenderedEmail;
  attachments?: readonly EmailAttachment[] | undefined;
}

export async function deliver(config: EmailConfig, delivery: Delivery, options: SendOptions = {}): Promise<void> {
  assertRendered(delivery.email);
  const { email, attachments } = delivery;
  const transporter = createTransporter(config, await connectHostFor(config, options));

  const files = [
    ...(attachments ?? []).map(({ filename, content, contentType }) => ({ filename, content, contentType })),
    // Inline images ride along as related parts the HTML references by \`cid:\`.
    ...email.inlineImages.map(({ cid, filename, contentType, base64 }) => ({
      cid,
      filename,
      contentType,
      content: Buffer.from(base64, "base64"),
      contentDisposition: "inline" as const,
    })),
  ];

  await transporter.sendMail({
    from: fromHeader(config),
    to: [...delivery.to],
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments: files,
  });
}
