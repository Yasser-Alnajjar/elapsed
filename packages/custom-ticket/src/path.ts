import { MappingError } from "./errors";

/**
 * The constrained JSONPath subset (plan 09, 4.5): `$`, `.key`, `['key']`,
 * `[n]`, `[*]`. No filters, recursion, expressions, slices or functions.
 * `__proto__`, `constructor` and `prototype` are rejected everywhere, and only
 * own properties are ever read, so a path can never reach the prototype chain.
 */
export type PathSegment = { kind: "key"; name: string } | { kind: "index"; index: number } | { kind: "wildcard" };

export const MAX_PATH_LENGTH = 256;
export const MAX_PATH_SEGMENTS = 12;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export type ParsedPath = readonly PathSegment[];

/** Returns the parsed path, or null when it is not in the subset. */
export function parsePath(path: string): ParsedPath | null {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) return null;
  if (path[0] !== "$") return null;
  const segments: PathSegment[] = [];
  let i = 1;
  while (i < path.length) {
    const ch = path[i];
    if (ch === ".") {
      let j = i + 1;
      while (j < path.length && path[j] !== "." && path[j] !== "[") j += 1;
      const name = path.slice(i + 1, j);
      if (!BARE_KEY.test(name) || FORBIDDEN_KEYS.has(name)) return null;
      segments.push({ kind: "key", name });
      i = j;
    } else if (ch === "[") {
      const close = findClose(path, i);
      if (close === -1) return null;
      const inner = path.slice(i + 1, close);
      if (inner === "*") segments.push({ kind: "wildcard" });
      else if (/^(0|[1-9][0-9]{0,8})$/.test(inner)) segments.push({ kind: "index", index: Number(inner) });
      else {
        const quote = inner[0];
        if ((quote !== "'" && quote !== '"') || inner.length < 2 || inner[inner.length - 1] !== quote) return null;
        const name = inner.slice(1, -1);
        // No escapes and no nested quotes: the subset keeps parsing trivial.
        if (name.length === 0 || name.length > 128 || /[\\'"\u0000-\u001f]/.test(name) || FORBIDDEN_KEYS.has(name)) return null;
        segments.push({ kind: "key", name });
      }
      i = close + 1;
    } else {
      return null;
    }
    if (segments.length > MAX_PATH_SEGMENTS) return null;
  }
  return segments;
}

function findClose(path: string, open: number): number {
  const quote = path[open + 1];
  if (quote === "'" || quote === '"') {
    const end = path.indexOf(quote, open + 2);
    return end !== -1 && path[end + 1] === "]" ? end + 1 : -1;
  }
  return path.indexOf("]", open);
}

export function isValidPath(path: string): boolean {
  return parsePath(path) !== null;
}

/** All values the path matches, in document order. A missing key or an out-of-range index matches nothing. */
export function evaluatePath(path: string | ParsedPath, document: unknown): unknown[] {
  const segments = typeof path === "string" ? parsePath(path) : path;
  if (segments === null) throw new MappingError("invalid_path");
  let current: unknown[] = [document];
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const value of current) {
      if (segment.kind === "key") {
        if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, segment.name)) {
          next.push((value as Record<string, unknown>)[segment.name]);
        }
      } else if (segment.kind === "index") {
        if (Array.isArray(value) && segment.index < value.length) next.push(value[segment.index]);
      } else if (Array.isArray(value)) {
        next.push(...value);
      } else if (value !== null && typeof value === "object") {
        next.push(...Object.values(value as Record<string, unknown>));
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}

/** The first match, or undefined. */
export function firstMatch(path: string | ParsedPath, document: unknown): unknown {
  return evaluatePath(path, document)[0];
}
