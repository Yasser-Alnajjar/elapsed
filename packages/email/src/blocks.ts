import type { EmailSwatch, EmailTone } from "./brand";

/**
 * The content vocabulary templates are written in. A template never emits
 * markup: it returns blocks, and the shared layout turns the same blocks into
 * both the HTML and the plain-text body. That is what keeps every email inside
 * the Elapsed shell, escaped, and with a text fallback that cannot drift from
 * the HTML.
 */

/** A run of text with optional emphasis. Plain strings are escaped; there is no way to pass markup. */
export type InlineText = string | { readonly strong: string };
export type RichText = string | readonly InlineText[];

/** One labeled fact: a cell in a `details` grid. */
export interface DetailRow {
  label: string;
  value: string;
}

/** One line of a `table`: a label, a figure, and optionally the stage color it belongs to. */
export interface TableRow {
  label: string;
  value: string;
  swatch?: EmailSwatch;
}

/** One cell of a `stats` strip. */
export interface Stat {
  label: string;
  value: string;
  tone?: EmailTone;
}

export type EmailBlock =
  /** A status pill at the top of the body ("▲ SLA AT RISK"). */
  | { readonly type: "badge"; readonly tone: EmailTone; readonly text: string }
  /** The email's title, with an optional line of context under it. */
  | { readonly type: "heading"; readonly text: string; readonly subtitle?: string }
  | { readonly type: "text"; readonly text: RichText; readonly muted?: boolean }
  /** Centered small print, usually after the call to action. */
  | { readonly type: "note"; readonly text: RichText }
  /** The one number the email is about, large, in the tone's color; `aside` is the figure it is measured against. */
  | { readonly type: "metric"; readonly tone: EmailTone; readonly label: string; readonly value: string; readonly aside?: { readonly label: string; readonly value: string } }
  /** A small-caps label that starts a group of content. */
  | { readonly type: "section"; readonly title: string }
  /** Labeled facts in a two-column grid. */
  | { readonly type: "details"; readonly rows: readonly DetailRow[] }
  /** Label/figure lines in a bordered list, e.g. time by stage. */
  | { readonly type: "table"; readonly rows: readonly TableRow[] }
  /** A strip of headline figures side by side. */
  | { readonly type: "stats"; readonly cells: readonly Stat[] }
  /** The call to action. `showUrl` repeats the raw link underneath, for clients that block buttons and for security-conscious readers. */
  | { readonly type: "button"; readonly label: string; readonly url: string; readonly showUrl?: boolean };

/** Emphasis inside a `RichText` run. */
export const strong = (text: string): InlineText => ({ strong: text });

/** The text of a `RichText` run with no formatting, for the plain-text body, preheaders and tests. */
export function plainText(text: RichText): string {
  if (typeof text === "string") return text;
  return text.map((part) => (typeof part === "string" ? part : part.strong)).join("");
}
