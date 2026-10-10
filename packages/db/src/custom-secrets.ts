import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { deriveEncryptionKey } from "./crypto";

/**
 * Strict per-value authenticated encryption for the `custom` ticket source's
 * credentials (N9.5, plan 09 8.4, Q8 and Q16). It reuses the deployment's
 * `INTEGRATION_TOKEN_ENCRYPTION_KEY` and the wire format
 * `enc:v1:<iv>.<tag>.<ciphertext>` (base64url, AES-256-GCM, a fresh 12-byte IV
 * per value), but differs from `integration-credentials.ts` in the ways that
 * matter for a secret an organization types in:
 *
 * - **Context binding.** Each ciphertext is bound, as GCM additional
 *   authenticated data, to `(organizationId, integrationId, field name)`. The
 *   data is not stored, so the wire format is unchanged, and a ciphertext moved
 *   to another organization, integration or field fails authentication.
 * - **Strict reads.** A value without the `enc:v1:` prefix is never returned as
 *   plaintext (`decryptToken` does that for rows awaiting migration; this must
 *   not). Every malformed form is rejected with one generic error.
 * - **No oracle.** There is one error, with a fixed message, no `cause` and no
 *   input, so the failure reveals neither the key, the ciphertext nor why.
 * - **Separate derived key.** The same environment secret, a different scrypt
 *   salt: this feature's ciphertext is never valid under the existing token
 *   key, and the existing token paths are untouched.
 *
 * Rotating `INTEGRATION_TOKEN_ENCRYPTION_KEY` makes every custom credential
 * unreadable at once; owners re-enter them until a rotation mechanism exists
 * (N8-S7). That is a documented limitation, not something this helper hides.
 */
const PREFIX = "enc:v1:";
const SALT = "sla-breach-monitoring/custom-provider-secrets";
const AAD_DOMAIN = "custom-secret:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 4096;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The binding for a draft's secrets, which exist before the integration does. */
export const DRAFT_INTEGRATION_ID = "draft";

export interface CustomSecretBinding {
  organizationId: string;
  /** The integration's id, or `DRAFT_INTEGRATION_ID` for a draft. */
  integrationId: string;
  /** The credential field name (`apiKey`, `token`, `username`, `password`, `headerValue`). */
  field: string;
}

export const CUSTOM_CREDENTIALS_UNREADABLE_MESSAGE = "Credentials unavailable; enter them again";

/**
 * Every failure to read a custom credential: unset or wrong key, a missing
 * prefix, malformed or tampered ciphertext, a ciphertext bound to another
 * context. Deliberately carries nothing else.
 */
export class CustomCredentialsUnreadableError extends Error {
  constructor() {
    super(CUSTOM_CREDENTIALS_UNREADABLE_MESSAGE);
    this.name = "CustomCredentialsUnreadableError";
  }
}

function key(): Buffer | null {
  const secret = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  return secret ? deriveEncryptionKey(secret, SALT) : null;
}

function aad(binding: CustomSecretBinding): Buffer {
  for (const part of [binding.organizationId, binding.integrationId, binding.field]) {
    if (typeof part !== "string" || part.length === 0 || part.includes("\u0000")) throw new CustomCredentialsUnreadableError();
  }
  return Buffer.from([AAD_DOMAIN, binding.organizationId, binding.integrationId, binding.field].join("\u0000"), "utf8");
}

/** True when `value` has the shape of a custom-secret ciphertext. A format check only: it is never the security guarantee. */
export function isCustomSecretCiphertext(value: unknown): value is string {
  return typeof value === "string" && parseCiphertext(value) !== null;
}

function parseCiphertext(value: string): { iv: Buffer; tag: Buffer; ciphertext: Buffer } | null {
  if (!value.startsWith(PREFIX)) return null;
  const parts = value.slice(PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  const [ivPart, tagPart, ctPart] = parts as [string, string, string];
  if (![ivPart, tagPart, ctPart].every((part) => BASE64URL.test(part))) return null;
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ctPart, "base64url");
  // Reject non-canonical encodings so one ciphertext has one spelling.
  if (iv.toString("base64url") !== ivPart || tag.toString("base64url") !== tagPart || ciphertext.toString("base64url") !== ctPart) return null;
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0 || ciphertext.length > MAX_PLAINTEXT_BYTES) return null;
  return { iv, tag, ciphertext };
}

/** Encrypts one secret value. Always writes the `enc:v1:` form; refuses an empty or oversized value. */
export function encryptCustomSecret(plaintext: string, binding: CustomSecretBinding): string {
  if (typeof plaintext !== "string" || plaintext.length === 0 || Buffer.byteLength(plaintext, "utf8") > MAX_PLAINTEXT_BYTES) {
    throw new Error("Custom credential values must be 1 to 4096 bytes");
  }
  const derived = key();
  if (!derived) throw new Error("INTEGRATION_TOKEN_ENCRYPTION_KEY must be set to encrypt custom integration credentials");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ciphertext].map((buf) => buf.toString("base64url")).join(".");
}

/** Decrypts one secret value, or throws `CustomCredentialsUnreadableError`. Never returns its input. */
export function decryptCustomSecret(value: unknown, binding: CustomSecretBinding): string {
  try {
    if (typeof value !== "string") throw new CustomCredentialsUnreadableError();
    const parsed = parseCiphertext(value);
    const derived = key();
    if (!parsed || !derived) throw new CustomCredentialsUnreadableError();
    const decipher = createDecipheriv("aes-256-gcm", derived, parsed.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(parsed.tag);
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // One outcome for every cause: the failure must not be an oracle.
    throw new CustomCredentialsUnreadableError();
  }
}

export interface CustomSecretContext {
  organizationId: string;
  integrationId: string;
}

/** Encrypts a `{ field: value }` map; every value is bound to its own field name. */
export function encryptCustomSecrets(values: Record<string, string>, context: CustomSecretContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(values)) out[field] = encryptCustomSecret(value, { ...context, field });
  return out;
}

/**
 * Decrypts the stored map. `fields` is the exact set the auth type needs: a
 * missing field, an extra field or an unreadable value fails the whole read,
 * so a half-readable credential set is never used.
 */
export function decryptCustomSecrets(stored: unknown, context: CustomSecretContext, fields: readonly string[]): Record<string, string> {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) throw new CustomCredentialsUnreadableError();
  const record = stored as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== fields.length || !fields.every((field) => Object.hasOwn(record, field))) throw new CustomCredentialsUnreadableError();
  const out: Record<string, string> = {};
  for (const field of fields) out[field] = decryptCustomSecret(record[field], { ...context, field });
  return out;
}

/** The set of field names that currently hold a value, for the "set / not set" UI. Never the values. */
export function customSecretFieldsSet(stored: unknown): string[] {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return [];
  return Object.entries(stored as Record<string, unknown>).filter(([, v]) => isCustomSecretCiphertext(v)).map(([k]) => k);
}
