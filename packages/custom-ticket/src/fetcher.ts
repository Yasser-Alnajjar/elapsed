import { SafeHttpError, type SafeHttpClient } from "@sla/safe-http";
import { buildRequest, itemsFrom, nextPosition, type Position, type Variables } from "./requests";
import type { PaginationConfig, RequestConfig } from "./schema";
import { SourceStatusError } from "./source-errors";

export interface Endpoint {
  request: RequestConfig;
  itemsPath: string;
  pagination: PaginationConfig;
}

export interface FetchedPage {
  items: unknown[];
  next: Position | null;
  json: unknown;
}

/** A child endpoint (comments, history) that has more pages than one ticket may use. */
export class ChildTooLargeError extends Error {
  constructor() {
    super("child_too_large");
    this.name = "ChildTooLargeError";
  }
}

export const MAX_CHILD_PAGES = 10;

/**
 * Fetches one page of an endpoint. Any status other than 2xx is a
 * `SourceStatusError` (the caller decides what a 401, 403 or 404 means); a
 * response that is not JSON, or is nested too deeply, is `bad_response`.
 */
export async function fetchPage(client: SafeHttpClient, endpoint: Endpoint, position: Position, vars: Variables): Promise<FetchedPage> {
  const request = buildRequest(endpoint.request, endpoint.pagination, position, vars, client.origin);
  const response = await client.request(request);
  if (response.status < 200 || response.status >= 300) throw new SourceStatusError(response.status);
  const json: unknown = response.status === 204 || response.text.trim() === "" ? {} : response.json();
  const items = itemsFrom(endpoint.itemsPath, json);
  const next = nextPosition(endpoint.pagination, position, { items, json, response, requestUrl: new URL(typeof request.url === "string" ? request.url : request.url.toString()) }, client.origin);
  return { items, next, json };
}

/** Every item of a child endpoint for one ticket, up to `MAX_CHILD_PAGES` pages; more is `ChildTooLargeError`, never a silent cut. */
export async function fetchAllItems(client: SafeHttpClient, endpoint: Endpoint, vars: Variables): Promise<unknown[]> {
  const items: unknown[] = [];
  let position: Position = { kind: "start" };
  for (let pages = 0; ; pages += 1) {
    if (pages >= MAX_CHILD_PAGES) throw new ChildTooLargeError();
    const page = await fetchPage(client, endpoint, position, vars);
    items.push(...page.items);
    if (page.next === null) return items;
    position = page.next;
  }
}

export function isSafeHttpError(error: unknown, code?: string): error is SafeHttpError {
  return error instanceof SafeHttpError && (code === undefined || error.code === code);
}
