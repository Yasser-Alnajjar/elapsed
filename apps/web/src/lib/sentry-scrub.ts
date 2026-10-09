import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { redactSentryEvent, redactValue } from "@sla/logger";

/**
 * Query parameters that carry credentials. `secret` is the legacy Jira
 * webhook secret (`/api/webhooks/jira/[integrationId]?secret=`, roadmap
 * step 43): Sentry copies both the request URL and its parsed query string
 * into every server-side error event, so an exception in that route would
 * otherwise ship the secret to Sentry.
 */
const SENSITIVE_QUERY_PARAMS = new Set(["secret"]);
const FILTERED = "[Filtered]";

/** Replaces sensitive query-parameter values in a URL or bare query string, leaving everything else byte-for-byte. */
export function scrubSensitiveQuery(value: string): string {
  return value.replace(/([?&]|^)([^=&#?]+)=([^&#]*)/g, (match, prefix: string, key: string) =>
    SENSITIVE_QUERY_PARAMS.has(safeDecode(key).toLowerCase()) ? `${prefix}${key}=${FILTERED}` : match,
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

type QueryParams = NonNullable<NonNullable<ErrorEvent["request"]>["query_string"]>;

function scrubQueryParams(query: QueryParams): QueryParams {
  if (typeof query === "string") return scrubSensitiveQuery(query);
  if (Array.isArray(query)) {
    return query.map(([key, value]) => [key, SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()) ? FILTERED : value]);
  }
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()) ? FILTERED : value]),
  );
}

/** `beforeSend` for both Sentry runtimes: strips sensitive query parameters from the request and breadcrumb URLs. */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    if (event.request.url) event.request.url = scrubSensitiveQuery(event.request.url);
    if (event.request.query_string) event.request.query_string = scrubQueryParams(event.request.query_string);
  }
  event.breadcrumbs = event.breadcrumbs?.map(scrubSentryBreadcrumb);
  // Shared redaction (N9.3): credential keys, Bearer/Basic values, stored ciphertext, URL userinfo and registered secrets.
  return redactSentryEvent(event);
}

/** `beforeBreadcrumb` counterpart, so an http/fetch breadcrumb never holds the raw URL either. */
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  if (!data) return redactValue(breadcrumb);
  const scrubbed = { ...data };
  for (const key of ["url", "http.query", "to", "from"]) {
    if (typeof scrubbed[key] === "string") scrubbed[key] = scrubSensitiveQuery(scrubbed[key]);
  }
  return redactValue({ ...breadcrumb, data: scrubbed });
}
