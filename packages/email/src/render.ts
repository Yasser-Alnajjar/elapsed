import { normalizeAppUrl, resolveAppUrl } from "./app-url";
import { renderEmailLayout } from "./layout";
import { LOGO_IMAGE } from "./logo";
import { issueRendered, type RenderedEmail } from "./rendered";
import type { EmailTemplateRequest } from "./request";
import type { EmailTemplate } from "./template";
import { EMAIL_TEMPLATES, type EmailTemplateData, type EmailTemplateId } from "./templates";

export interface EmailRenderContext {
  /** The deployment origin for footer links. Omit to read `NEXTAUTH_URL`; pass `null` for "none configured". */
  appUrl?: string | null | undefined;
  /** The clock for the copyright year. Defaults to now. */
  now?: Date | undefined;
}

/** Thrown for a template id that is not registered. A cast or a JavaScript caller cannot send what the registry does not know. */
export class UnknownEmailTemplateError extends Error {
  constructor(template: string) {
    super(`Unknown email template "${template}".`);
    this.name = "UnknownEmailTemplateError";
  }
}

/** A subject is one line: user-supplied names inside it must not be able to add headers. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const PREHEADER_LIMIT = 140;

function renderTemplate<K extends EmailTemplateId>(id: K, data: EmailTemplateData<K>, context: EmailRenderContext): RenderedEmail {
  const template = EMAIL_TEMPLATES[id] as unknown as EmailTemplate<EmailTemplateData<K>>;
  const subject = oneLine(template.subject(data));
  const preheader = oneLine(template.preheader(data)).slice(0, PREHEADER_LIMIT);
  const { html, text } = renderEmailLayout({
    subject,
    preheader,
    category: template.category,
    notificationSettingsLink: template.notificationSettingsLink ?? false,
    blocks: template.content(data),
    footnote: template.footnote?.(data),
    appUrl: context.appUrl === undefined ? resolveAppUrl() : normalizeAppUrl(context.appUrl),
    year: (context.now ?? new Date()).getUTCFullYear(),
  });
  return issueRendered({ subject, text, html, inlineImages: [LOGO_IMAGE] });
}

/**
 * Renders a registered template into a finished email — subject, plain text
 * and HTML — inside the Elapsed layout. This is the only way to produce a
 * `RenderedEmail`, and `sendEmail` calls it for every message.
 */
export function renderEmail(request: EmailTemplateRequest, context: EmailRenderContext = {}): RenderedEmail {
  if (!Object.hasOwn(EMAIL_TEMPLATES, request.template)) throw new UnknownEmailTemplateError(String(request.template));
  return renderTemplate(request.template, request.data, context);
}
