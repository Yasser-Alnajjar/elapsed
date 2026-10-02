import { ADMIN_AUDIT_ACTIONS, type AdminAuditAction, type AdminAuditFilters } from "./types/admin";

/** The audit page's query string, as Next hands it over (a repeated key can arrive as an array). */
export interface AuditSearchParams {
  before?: string | string[];
  action?: string | string[];
  actor?: string | string[];
  org?: string | string[];
  hideViews?: string | string[];
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** Longest operator search or id accepted from a URL; anything longer is not an email or a cuid. */
const MAX_PARAM_LENGTH = 200;

/** Reads the filters out of the URL. Unknown actions and oversized values are dropped, never passed to the database. */
export function parseAuditFilters(params: AuditSearchParams): AdminAuditFilters {
  const action = first(params.action);
  const actor = first(params.actor)?.trim().slice(0, MAX_PARAM_LENGTH);
  const org = first(params.org)?.trim().slice(0, MAX_PARAM_LENGTH);
  return {
    action: (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(action ?? "") ? (action as AdminAuditAction) : null,
    actor: actor ? actor : null,
    organizationId: org ? org : null,
    hideViews: first(params.hideViews) === "1",
  };
}

/** The query string for a set of filters (and an optional page cursor), omitting every default. "" when there is nothing to say. */
export function auditQuery(filters: AdminAuditFilters, before?: string | null): string {
  const query = new URLSearchParams();
  if (filters.action) query.set("action", filters.action);
  if (filters.actor) query.set("actor", filters.actor);
  if (filters.organizationId) query.set("org", filters.organizationId);
  if (filters.hideViews && !filters.action) query.set("hideViews", "1");
  if (before) query.set("before", before);
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function hasAuditFilters(filters: AdminAuditFilters): boolean {
  return Boolean(filters.action || filters.actor || filters.organizationId || filters.hideViews);
}

/** The page cursor from the URL (the previous page's `nextCursor`), or null for the newest page. */
export function parseAuditCursor(params: AuditSearchParams): string | null {
  const before = first(params.before)?.trim().slice(0, MAX_PARAM_LENGTH);
  return before ? before : null;
}
