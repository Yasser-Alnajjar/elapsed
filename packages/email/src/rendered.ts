import type { InlineImage } from "./logo";

declare const renderedBrand: unique symbol;

/**
 * A finished email: subject, plain-text body and HTML body, all produced by
 * `renderEmail` through the Elapsed layout. The type cannot be constructed
 * outside this package, and the transport re-checks at runtime (below), so
 * hand-written `{ subject, text, html }` can never reach the wire.
 */
export interface RenderedEmail {
  readonly [renderedBrand]: true;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Images the HTML references by \`cid:\`. Always includes the Elapsed logo. */
  readonly inlineImages: readonly InlineImage[];
}

const issued = new WeakSet<object>();

/** Only `renderEmail` calls this. */
export function issueRendered(email: { subject: string; text: string; html: string; inlineImages: readonly InlineImage[] }): RenderedEmail {
  const rendered = Object.freeze({ ...email }) as unknown as RenderedEmail;
  issued.add(rendered);
  return rendered;
}

/** Thrown by the transport when asked to send something `renderEmail` did not produce. */
export class UnrenderedEmailError extends Error {
  constructor() {
    super("Only emails rendered through the Elapsed template layout can be sent.");
    this.name = "UnrenderedEmailError";
  }
}

export function assertRendered(email: unknown): asserts email is RenderedEmail {
  if (typeof email !== "object" || email === null || !issued.has(email)) throw new UnrenderedEmailError();
}
