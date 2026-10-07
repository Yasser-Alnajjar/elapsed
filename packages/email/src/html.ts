/** Minimal, dependency-free escaping. Every dynamic value in an email is text, never markup; this is safe for element content and quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Thrown when a template is given a link that is not http(s) or mailto, so a `javascript:` URL can never reach an `href`. */
export class InvalidEmailUrlError extends Error {
  constructor() {
    super("Email links must be absolute http(s) or mailto URLs.");
    this.name = "InvalidEmailUrlError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Returns `url` unchanged when it is an absolute http(s)/mailto URL, otherwise throws `InvalidEmailUrlError`. */
export function assertSafeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidEmailUrlError();
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new InvalidEmailUrlError();
  return url;
}
