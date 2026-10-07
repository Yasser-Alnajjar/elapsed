import { renderEmail } from "./render";
import type { EmailRequest } from "./request";
import { deliver, type SendOptions } from "./transport";
import type { EmailConfig } from "./types";

export type SendEmailInput = EmailRequest & {
  /** Which SMTP server delivers it. The provider only delivers; it never sees a template. */
  smtp: EmailConfig;
  delivery?: SendOptions | undefined;
  /** The deployment origin for footer links. Omit to read `NEXTAUTH_URL`; pass `null` for "none configured". */
  appUrl?: string | null | undefined;
  now?: Date | undefined;
};

/**
 * Sends one email: `{ template, data }` rendered through the Elapsed layout,
 * then handed to the SMTP transport. It is the package's only way to send
 * mail. Everything the recipient sees is produced by the template and the
 * shared layout; the transport receives the finished result and nothing the
 * caller passed in besides the recipients and attachments.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const email = renderEmail(input, { appUrl: input.appUrl, now: input.now });
  await deliver(input.smtp, { to: input.to, email, attachments: input.attachments }, input.delivery);
}
