import type { EmailTemplateData, EmailTemplateId } from "./templates";
import type { EmailAttachment } from "./types";

/**
 * What to send, as data: a registered template and the data it needs. The
 * union is distributive, so `template` and `data` always agree
 * (`{ template: "password-reset", data: { resetUrl, ttlMinutes } }`), and there
 * is no field for a subject, a text body or HTML — those come from the template.
 */
export type EmailTemplateRequest<K extends EmailTemplateId = EmailTemplateId> = {
  [P in K]: { template: P; data: EmailTemplateData<P> };
}[K];

/** A template request addressed to recipients. One message is sent per call; callers wanting one message per recipient call once for each. */
export type EmailRequest<K extends EmailTemplateId = EmailTemplateId> = EmailTemplateRequest<K> & {
  to: readonly string[];
  attachments?: readonly EmailAttachment[];
};
