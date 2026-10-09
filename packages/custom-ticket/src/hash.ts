import { createHash } from "node:crypto";

/**
 * Stable content hash for a JSON-serializable payload. Keys are sorted
 * recursively so field-order differences from the API never register as a
 * change; the hash is folded into the raw event id so an unchanged re-fetch
 * collides with the existing row (skipped) while a real change lands as a new
 * snapshot. Same scheme as the other providers.
 */
export function computeSourceHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
