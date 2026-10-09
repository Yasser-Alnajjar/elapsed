import { parsePath, type PathSegment } from "./path";
import { pathsIn } from "./validate";
import type { CustomConfig, Expr } from "./schema";

/**
 * Whitelist projection (plan 09, section 7): what is stored of a source
 * record is only the values the mapping reads, at their original nesting, so
 * the same path expressions evaluate against the stored copy. Unmapped fields
 * (emails, phone numbers, attachments, internal notes) are never stored.
 */
export const MAX_STORED_PAYLOAD_BYTES = 64 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function project(source: unknown, segments: readonly PathSegment[], i: number): unknown {
  if (i === segments.length) return structuredCloneJson(source);
  const segment = segments[i]!;
  if (segment.kind === "key") {
    if (!isPlainObject(source) || !Object.hasOwn(source, segment.name)) return undefined;
    const child = project(source[segment.name], segments, i + 1);
    return child === undefined ? undefined : { [segment.name]: child };
  }
  if (segment.kind === "index") {
    if (!Array.isArray(source) || segment.index >= source.length) return undefined;
    const child = project(source[segment.index], segments, i + 1);
    if (child === undefined) return undefined;
    const out: unknown[] = new Array(segment.index + 1).fill(null);
    out[segment.index] = child;
    return out;
  }
  if (Array.isArray(source)) return source.map((element) => project(element, segments, i + 1) ?? null);
  if (isPlainObject(source)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      const child = project(value, segments, i + 1);
      if (child !== undefined) out[key] = child;
    }
    return out;
  }
  return undefined;
}

function structuredCloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function merge(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.max(a.length, b.length);
    return Array.from({ length }, (_, index) => {
      const left = index < a.length ? a[index] : null;
      const right = index < b.length ? b[index] : null;
      return left === null ? right : right === null ? left : merge(left, right);
    });
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) out[key] = Object.hasOwn(out, key) ? merge(out[key], value) : value;
    return out;
  }
  return b;
}

/** The projection of `document` onto `paths`. Always an object (an empty one when nothing matches). */
export function projectByPaths(document: unknown, paths: readonly string[]): Record<string, unknown> {
  let result: unknown = {};
  for (const path of new Set(paths)) {
    const segments = parsePath(path);
    if (!segments) continue;
    const fragment = project(document, segments, 0);
    if (fragment !== undefined && isPlainObject(fragment)) result = merge(result, fragment);
  }
  return result as Record<string, unknown>;
}

function serializeSegments(segments: readonly PathSegment[]): string {
  return `$${segments
    .map((segment) => (segment.kind === "key" ? `['${segment.name}']` : segment.kind === "index" ? `[${segment.index}]` : "[*]"))
    .join("")}`;
}

/** `base` followed by a path written relative to the item (`$.author.type`): the path of that field inside the parent document. */
export function composePaths(base: string, relative: string): string | null {
  const a = parsePath(base);
  const b = parsePath(relative);
  if (!a || !b) return null;
  return serializeSegments([...a, ...b]);
}

function collect(exprs: (Expr | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const expr of exprs) if (expr !== undefined && expr !== null) out.push(...pathsIn(expr));
  return out;
}

export function commentPaths(config: CustomConfig): string[] {
  const m = config.commentMapping;
  return m ? collect([m.id, m.createdAt, m.authorRole, m.isPublic, m.body, m.authorName]) : [];
}

export function historyPaths(config: CustomConfig): string[] {
  const m = config.statusHistory?.mapping;
  return m ? collect([m.id, m.changedAt, m.toStatus, m.fromStatus]) : [];
}

/**
 * Every path of a ticket item the mapping (or a rule that reads the ticket)
 * uses. When comments are embedded in the ticket, their fields are included
 * at their embedded location so the stored ticket evaluates them unchanged.
 */
export function ticketPaths(config: CustomConfig): string[] {
  const m = config.mapping;
  const paths = collect([m.id, m.createdAt, m.status, m.title, m.priority, m.updatedAt, m.customerId, m.customerName, m.closedAt, m.channel]);
  if (m.tags) paths.push(m.tags);
  if (config.creationActor?.type === "path") paths.push(...collect([config.creationActor.path]));
  if (config.deletion?.flagPath) paths.push(config.deletion.flagPath);
  if (config.comments && !config.comments.request) {
    const embedded = commentPaths(config);
    if (embedded.length === 0) paths.push(config.comments.itemsPath);
    for (const relative of embedded) {
      const composed = composePaths(config.comments.itemsPath, relative);
      if (composed) paths.push(composed);
    }
  }
  return [...new Set(paths)];
}
