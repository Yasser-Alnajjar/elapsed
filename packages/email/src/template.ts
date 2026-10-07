import type { EmailCategory } from "./brand";
import type { EmailBlock } from "./blocks";

/**
 * What a template is allowed to define: its category, subject, inbox preview,
 * the reason the recipient got it, and its content as blocks. There is
 * deliberately no field for markup, a stylesheet, a header or a footer — the
 * shared layout owns all of it, so a template cannot render outside the
 * Elapsed shell.
 */
export interface EmailTemplate<Data> {
  /** Labels the pill in the header. */
  category: EmailCategory;
  /** Adds "Manage notification settings" to the footer. Only for mail the recipient can configure there. */
  notificationSettingsLink?: boolean;
  subject(data: Data): string;
  /** Inbox preview text. */
  preheader(data: Data): string;
  /** Why the recipient got this email, shown above the standard footer. */
  footnote?(data: Data): string | undefined;
  content(data: Data): readonly EmailBlock[];
}

/** Identity function that fixes `Data` from the argument, so templates are written without repeating generics. */
export function defineEmailTemplate<Data>(template: EmailTemplate<Data>): EmailTemplate<Data> {
  return template;
}
