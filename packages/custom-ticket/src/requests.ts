import { SafeHttpError, assertSameOrigin, buildUrl, type ParsedOrigin, type SafeRequest, type SafeResponse } from "@sla/safe-http";
import { evaluatePath } from "./path";
import type { PaginationConfig, RequestConfig } from "./schema";

/** Where a paginated listing stands. Persisted in the cursor, so every field is a small JSON value. */
export type Position =
  | { kind: "start" }
  | { kind: "page"; page: number }
  | { kind: "offset"; offset: number }
  | { kind: "cursor"; cursor: string }
  | { kind: "url"; url: string };

export const START: Position = { kind: "start" };
const DEFAULT_PAGE_SIZE = 100;

export interface Variables {
  updatedSince?: string;
  cursor?: string;
  page?: number;
  offset?: number;
  limit?: number;
  "ticket.id"?: string;
}

const VARIABLE = /\{\{\s*([A-Za-z.]+)\s*\}\}/g;
const WHOLE_VARIABLE = /^\{\{\s*([A-Za-z.]+)\s*\}\}$/;
const NUMERIC_VARIABLES = new Set(["limit", "page", "offset"]);

function lookup(vars: Variables, name: string): string | number | undefined {
  return (vars as Record<string, string | number | undefined>)[name];
}

/** Substitutes into a string; `encode` URL-encodes (path segments). An undefined variable renders empty. */
function renderString(template: string, vars: Variables, encode: boolean): string {
  return template.replace(VARIABLE, (_m, name: string) => {
    const value = lookup(vars, name);
    if (value === undefined) return "";
    const text = String(value);
    return encode ? encodeURIComponent(text) : text;
  });
}

function renderJson(value: unknown, vars: Variables): unknown {
  if (typeof value === "string") {
    const whole = WHOLE_VARIABLE.exec(value);
    if (whole) {
      const resolved = lookup(vars, whole[1]!);
      if (resolved === undefined) return "";
      return NUMERIC_VARIABLES.has(whole[1]!) ? Number(resolved) : String(resolved);
    }
    return renderString(value, vars, false);
  }
  if (Array.isArray(value)) return value.map((item) => renderJson(item, vars));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderJson(item, vars)]));
  }
  return value;
}

export function pageSizeOf(pagination: PaginationConfig): number {
  return "pageSize" in pagination && typeof pagination.pageSize === "number" ? pagination.pageSize : DEFAULT_PAGE_SIZE;
}

/**
 * Builds the HTTP request for one page of an endpoint: the endpoint's
 * template with variables substituted (only into URL-encoded path segments,
 * query values and JSON string values, never into scheme, host or port), plus
 * the pagination parameters for `position`. For `next_url` and `Link` header
 * pagination after the first page, the request is the validated same-origin
 * URL the source gave.
 */
export function buildRequest(
  request: RequestConfig,
  pagination: PaginationConfig,
  position: Position,
  vars: Variables,
  origin: ParsedOrigin,
): SafeRequest {
  const filled: Variables = { ...vars, limit: vars.limit ?? pageSizeOf(pagination) };
  if (position.kind === "page") filled.page = position.page;
  if (position.kind === "offset") filled.offset = position.offset;
  if (position.kind === "cursor") filled.cursor = position.cursor;

  if (position.kind === "url") {
    return {
      method: request.method,
      url: assertSameOrigin(origin, position.url),
      ...(request.headers ? { headers: request.headers } : {}),
      ...(request.method === "POST" && request.body !== undefined ? { body: JSON.stringify(renderJson(request.body, filled)) } : {}),
    };
  }

  const path = renderString(request.path, filled, true);
  const query: Record<string, string> = {};
  for (const [key, template] of Object.entries(request.query ?? {})) {
    const whole = WHOLE_VARIABLE.exec(template);
    if (whole && lookup(filled, whole[1]!) === undefined) continue; // a lone unset variable omits the parameter
    query[key] = renderString(template, filled, false);
  }
  let body: Record<string, unknown> | undefined =
    request.method === "POST" && request.body !== undefined ? (renderJson(request.body, filled) as Record<string, unknown>) : undefined;

  const set = (location: "query" | "body", key: string, value: string | number): void => {
    if (location === "query") query[key] = String(value);
    else {
      body = typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};
      body[key] = value;
    }
  };
  switch (pagination.type) {
    case "page":
      set(pagination.in, pagination.param, position.kind === "page" ? position.page : pagination.startAt);
      if (pagination.sizeParam) set(pagination.in, pagination.sizeParam, pagination.pageSize);
      break;
    case "offset":
      set(pagination.in, pagination.offsetParam, position.kind === "offset" ? position.offset : 0);
      set(pagination.in, pagination.limitParam, pagination.pageSize);
      break;
    case "cursor":
      if (position.kind === "cursor") set(pagination.in, pagination.param, position.cursor);
      if (pagination.sizeParam && pagination.pageSize) set(pagination.in, pagination.sizeParam, pagination.pageSize);
      break;
    default:
      break;
  }

  return {
    method: request.method,
    url: buildUrl(origin, path.startsWith("/") ? path : `/${path}`, query),
    ...(request.headers ? { headers: request.headers } : {}),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

/** `Link: <https://...>; rel="next", <...>; rel="last"` (RFC 8288): the `rel="next"` target, or null. */
export function parseLinkNext(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(/,(?=\s*<)/)) {
    const match = /^\s*<([^>]*)>\s*((?:;[^;]*)*)$/.exec(part);
    if (!match) continue;
    const rel = /;\s*rel\s*=\s*("([^"]*)"|[^;\s]+)/i.exec(match[2]!);
    const relValue = (rel?.[2] ?? rel?.[1] ?? "").replace(/"/g, "");
    if (relValue.split(/\s+/).includes("next")) return match[1]!;
  }
  return null;
}

/**
 * The position after this page, or null when it was the last. Throws
 * `bad_response` on a loop (a cursor or URL that repeats). The caller has
 * already parsed the response; `items` are the page's records.
 */
export function nextPosition(
  pagination: PaginationConfig,
  current: Position,
  page: { items: unknown[]; json: unknown; response: SafeResponse; requestUrl: URL },
  origin: ParsedOrigin,
): Position | null {
  const { items } = page;
  switch (pagination.type) {
    case "none":
      return null;
    case "page": {
      const currentPage = current.kind === "page" ? current.page : pagination.startAt;
      if (items.length === 0 || items.length < pagination.pageSize) return null;
      return { kind: "page", page: currentPage + 1 };
    }
    case "offset": {
      const offset = current.kind === "offset" ? current.offset : 0;
      if (items.length === 0 || items.length < pagination.pageSize) return null;
      return { kind: "offset", offset: offset + items.length };
    }
    case "cursor": {
      const raw = evaluatePath(pagination.cursorPath, page.json)[0];
      if (raw === undefined || raw === null || raw === "" || raw === false) return null;
      if (typeof raw !== "string" && typeof raw !== "number") throw new SafeHttpError("bad_response");
      const cursor = String(raw);
      if (cursor.length > 2048) throw new SafeHttpError("bad_response");
      if (current.kind === "cursor" && current.cursor === cursor) throw new SafeHttpError("bad_response");
      if (items.length === 0) return null;
      return { kind: "cursor", cursor };
    }
    case "next_url":
    case "link_header": {
      const raw =
        pagination.type === "next_url" ? evaluatePath(pagination.nextPath, page.json)[0] : parseLinkNext(page.response.headers["link"]);
      if (raw === undefined || raw === null || raw === "") return null;
      if (typeof raw !== "string") throw new SafeHttpError("bad_response");
      const resolved = new URL(raw, page.requestUrl); // relative targets resolve against the request
      const next = assertSameOrigin(origin, resolved);
      if (next.toString() === page.requestUrl.toString()) throw new SafeHttpError("bad_response");
      return { kind: "url", url: next.toString() };
    }
  }
}

/** The records a list response holds at `itemsPath`: the array itself, or the matches of a wildcard. */
export function itemsFrom(itemsPath: string, json: unknown): unknown[] {
  const matches = evaluatePath(itemsPath, json);
  if (matches.length === 1 && Array.isArray(matches[0]) && !itemsPath.includes("[*]")) return matches[0] as unknown[];
  return matches;
}
