/**
 * Redaction of credentials and sensitive URLs from anything that leaves the
 * process as text: application logs, Sentry events, sync errors (plan 09, 8.4
 * and N9.3). It is output-only: values that carry no secret are returned
 * unchanged, so what other code logs today does not change.
 *
 * Three layers, because none alone is enough:
 * 1. Key names: a value under `authorization`, `password`, `secrets`, ... is
 *    replaced wholesale.
 * 2. Shapes: `Bearer ...`, `Basic ...`, stored ciphertext (`enc:v1:...`),
 *    `user:pass@` in a URL and credential-looking query parameters are
 *    replaced inside any string.
 * 3. Registered values: a component that holds a live secret (the custom
 *    ticket client, for the length of a run) registers it, and every
 *    occurrence of that exact value, or of an encoding of it, is replaced
 *    wherever it appears, including in third-party error messages.
 *
 * No Node-only imports: this file is also loaded by the Edge runtime.
 */
export const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
const MIN_SECRET_LENGTH = 4;

const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|apikey|password|passwd|secret|secrets|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|private[-_]?key|credential|credentials|ciphertext|signature)$/i;

const SENSITIVE_QUERY_KEY = "key|api[-_]?key|apikey|token|access[-_]?token|secret|password|passwd|auth|authorization|signature|sig|credential|credentials";
const QUERY_PARAM = new RegExp(`([?&;]\\s*(?:${SENSITIVE_QUERY_KEY}))=([^&#\\s"']*)`, "gi");
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g;
const CIPHERTEXT = /enc:v1:[A-Za-z0-9_.-]+/g;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

/** Live secrets, reference-counted so two runs holding the same value do not unregister each other. */
const registered = new Map<string, number>();

function variantsOf(value: string): string[] {
  const out = new Set<string>([value]);
  try {
    out.add(encodeURIComponent(value));
  } catch {
    /* lone surrogate: skip */
  }
  out.add(JSON.stringify(value).slice(1, -1));
  out.add(btoa(unescapeSafe(value)));
  return [...out].filter((variant) => variant.length >= MIN_SECRET_LENGTH);
}

function unescapeSafe(value: string): string {
  // btoa throws on non-Latin1; fall back to the UTF-8 bytes.
  try {
    btoa(value);
    return value;
  } catch {
    return String.fromCharCode(...new TextEncoder().encode(value));
  }
}

/**
 * Registers secret values for the lifetime of a scope; call the returned
 * function to unregister. Encodings (URL, JSON-escaped, base64) are
 * registered with the value. Values shorter than four characters are ignored
 * (they would redact ordinary text).
 */
export function registerSecretValues(values: Iterable<string>): () => void {
  const added: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) continue;
    for (const variant of variantsOf(value)) {
      registered.set(variant, (registered.get(variant) ?? 0) + 1);
      added.push(variant);
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const variant of added) {
      const count = (registered.get(variant) ?? 1) - 1;
      if (count <= 0) registered.delete(variant);
      else registered.set(variant, count);
    }
  };
}

/** Test and shutdown helper. */
export function clearRegisteredSecrets(): void {
  registered.clear();
}

export function redactString(input: string): string {
  let text = input;
  // Longest first so a value that contains another registered value is replaced whole.
  if (registered.size > 0) {
    for (const secret of [...registered.keys()].sort((a, b) => b.length - a.length)) {
      if (text.includes(secret)) text = text.split(secret).join(REDACTED);
    }
  }
  if (text.includes("enc:v1:")) text = text.replace(CIPHERTEXT, "[REDACTED_CIPHERTEXT]");
  if (text.includes("Bearer") || text.includes("Basic")) text = text.replace(BEARER, `$1 ${REDACTED}`);
  if (text.includes("@") && text.includes("://")) text = text.replace(URL_USERINFO, `$1${REDACTED}@`);
  if (text.includes("=")) text = text.replace(QUERY_PARAM, `$1=${REDACTED}`);
  return text;
}

/**
 * Returns a redacted deep copy of `value`. Primitives other than strings and
 * values without a secret are returned as they are. Depth-limited and
 * cycle-safe. An `Error` becomes a plain object of its own enumerable
 * properties, which is exactly what `JSON.stringify` already emitted for it.
 */
export function redactValue<T>(value: T): T {
  return walk(value, 0, new WeakSet()) as T;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen));
    if (value instanceof Date || value instanceof RegExp) return value;
    if (typeof (value as { toJSON?: unknown }).toJSON === "function" && !(value instanceof Error)) {
      return walk((value as { toJSON(): unknown }).toJSON(), depth + 1, seen);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      out[key] = SENSITIVE_KEY.test(key) && child !== null && child !== undefined && child !== "" ? REDACTED : walk(child, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** Error classes whose context must never reach an error tracker: only the generic message survives. */
const OPAQUE_ERROR_TYPES = new Set(["IntegrationCredentialsUnreadableError", "CustomCredentialsUnreadableError"]);
export const CREDENTIALS_UNREADABLE_MESSAGE = "Credentials unavailable; enter them again";

interface SentryLikeEvent {
  exception?: { values?: { type?: string; value?: string; [key: string]: unknown }[] };
  message?: unknown;
  extra?: unknown;
  [key: string]: unknown;
}

/**
 * `beforeSend` core for any Sentry runtime: redacts the whole event, and for a
 * credentials-unreadable error keeps only that error with a generic message
 * (no cause chain, no `extra`), so neither the ciphertext, the key nor the
 * original crypto error can leave the process.
 */
export function redactSentryEvent<E extends object>(event: E): E {
  const input = event as unknown as SentryLikeEvent;
  const values = input.exception?.values;
  if (values?.some((entry) => entry.type !== undefined && OPAQUE_ERROR_TYPES.has(entry.type))) {
    const kept = values
      .filter((entry) => entry.type !== undefined && OPAQUE_ERROR_TYPES.has(entry.type))
      .map((entry) => ({ type: entry.type, value: CREDENTIALS_UNREADABLE_MESSAGE }));
    input.exception = { values: kept };
    delete input.extra;
    input.message = CREDENTIALS_UNREADABLE_MESSAGE;
  }
  return redactValue(input) as unknown as E;
}
