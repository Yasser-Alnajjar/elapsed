import { fetchWithRetry } from "@sla/http-retry";
import type {
  ZendeskAuditsPage,
  ZendeskBusinessHoursSchedulesPage,
  ZendeskCredentials,
  ZendeskIncrementalOrganizationExport,
  ZendeskIncrementalTicketExport,
  ZendeskJiraLinksPage,
  ZendeskScheduleHolidaysPage,
  ZendeskSlaPoliciesPage,
  ZendeskTicketShow,
} from "./types";
import { PERMISSION_DENIED_BRAND } from "@sla/ingestion";

export class ZendeskApiError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`Zendesk API error ${status} for ${url}`);
    this.name = "ZendeskApiError";
    this.status = status;
  }
}

/**
 * A 403: the token is still valid, but the user who connected the
 * integration can no longer read what was asked for (role downgraded,
 * access revoked on Zendesk's side). Distinct from a 401 — reconnecting
 * would mint the same user's token with the same permissions, so the fix is
 * restoring that user's access in Zendesk, not a new OAuth grant.
 * Subclasses `ZendeskApiError` so existing `status` checks keep working.
 */
export class ZendeskPermissionDeniedError extends ZendeskApiError {
  readonly [PERMISSION_DENIED_BRAND] = true as const;
  constructor(url: string) {
    super(403, url);
    this.name = "ZendeskPermissionDeniedError";
  }
}

export interface ZendeskClientOptions {
  /**
   * Called at most once per request when Zendesk responds 401. Receives the
   * credentials that were just rejected (so the caller can tell whether
   * another process already rotated them) and must return credentials to
   * retry with. Throwing here (e.g. a reauth-required error) aborts the retry.
   */
  onUnauthorized?: (failedCredentials: ZendeskCredentials) => Promise<ZendeskCredentials>;
}

/** Thin, provider-aware fetch wrapper. Everything past this file is provider-agnostic. */
export class ZendeskClient {
  private credentials: ZendeskCredentials;
  private readonly onUnauthorized?: (failedCredentials: ZendeskCredentials) => Promise<ZendeskCredentials>;

  constructor(credentials: ZendeskCredentials, options: ZendeskClientOptions = {}) {
    this.credentials = credentials;
    this.onUnauthorized = options.onUnauthorized;
  }

  private baseUrl(): string {
    return `https://${this.credentials.subdomain}.zendesk.com`;
  }

  private async request<T>(path: string, hasRetriedAuth = false): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl()}${path}`;
    const response = await fetchWithRetry(
      () => fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } }),
      { isRetryableStatus: (r) => r.status === 429 },
    );

    if (response.status === 401 && this.onUnauthorized && !hasRetriedAuth) {
      this.credentials = await this.onUnauthorized(this.credentials);
      return this.request<T>(path, true);
    }

    if (response.status === 403) {
      throw new ZendeskPermissionDeniedError(url);
    }

    if (!response.ok) {
      throw new ZendeskApiError(response.status, url);
    }

    return (await response.json()) as T;
  }

  /**
   * https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/
   * Sideloads `users` (each page's tickets' requesters/assignees/etc.,
   * deduplicated by Zendesk) so the normalizer can resolve a ticket's
   * requester name without a separate per-ticket/per-user request.
   */
  fetchTicketsPage(startTime: number): Promise<ZendeskIncrementalTicketExport> {
    return this.request<ZendeskIncrementalTicketExport>(
      `/api/v2/incremental/tickets.json?start_time=${startTime}&include=users`,
    );
  }

  /** `include` is re-applied in case Zendesk doesn't carry it over to `next_page` (mirrors `fetchTicketAuditsPage`). */
  fetchTicketsNextPage(nextPageUrl: string): Promise<ZendeskIncrementalTicketExport> {
    const url = new URL(nextPageUrl);
    if (!url.searchParams.has("include")) url.searchParams.set("include", "users");
    return this.request<ZendeskIncrementalTicketExport>(url.toString());
  }

  fetchOrganizationsPage(startTime: number): Promise<ZendeskIncrementalOrganizationExport> {
    return this.request<ZendeskIncrementalOrganizationExport>(
      `/api/v2/incremental/organizations.json?start_time=${startTime}`,
    );
  }

  fetchOrganizationsNextPage(nextPageUrl: string): Promise<ZendeskIncrementalOrganizationExport> {
    return this.request<ZendeskIncrementalOrganizationExport>(nextPageUrl);
  }

  fetchSlaPoliciesPage(nextPageUrl?: string): Promise<ZendeskSlaPoliciesPage> {
    return this.request<ZendeskSlaPoliciesPage>(nextPageUrl ?? "/api/v2/slas/policies.json");
  }

  /**
   * The official Zendesk↔Jira integration's structured link registry:
   * `{ticket_id, issue_key}` pairs Zendesk itself maintains, independent of
   * whatever URL a Jira remote link happens to carry. Treated as the
   * authoritative correlation signal (see packages/zendesk/src/correlate.ts)
   * — it still resolves the relationship when a remote link exists but
   * points at a stale Zendesk subdomain.
   *
   * The first page is fetched with no query params — confirmed live against
   * a real connected account. `afterCursor` (from a prior page's
   * `meta.after_cursor`, per `ZendeskJiraLinksPage`'s doc comment) is only
   * ever added for a continuation request, so an account whose whole
   * registry fits on one page (the common case — this endpoint has no
   * `next_page`-URL style to instead default to) is completely unaffected.
   */
  fetchJiraLinksPage(afterCursor?: string): Promise<ZendeskJiraLinksPage> {
    if (!afterCursor) return this.request<ZendeskJiraLinksPage>("/api/v2/jira/links");
    const params = new URLSearchParams({ "page[after]": afterCursor });
    return this.request<ZendeskJiraLinksPage>(`/api/v2/jira/links?${params.toString()}`);
  }

  /**
   * Sideloads `users` (https://developer.zendesk.com/documentation/ticketing/using-the-zendesk-api/side_loading/)
   * so each audit author's role arrives in the same response — no separate
   * Users API call. `include` is re-applied to `nextPageUrl` in case Zendesk
   * doesn't carry it over to later pages.
   */
  fetchTicketAuditsPage(ticketId: number, nextPageUrl?: string): Promise<ZendeskAuditsPage> {
    if (!nextPageUrl) {
      return this.request<ZendeskAuditsPage>(`/api/v2/tickets/${ticketId}/audits.json?include=users`);
    }
    const url = new URL(nextPageUrl);
    if (!url.searchParams.has("include")) url.searchParams.set("include", "users");
    return this.request<ZendeskAuditsPage>(url.toString());
  }

  /**
   * https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#show-ticket
   * Single-ticket fetch for a targeted refetch (roadmap step 20's webhook
   * receiver) — unlike the incremental export, this reflects the ticket's
   * state at the moment of the call rather than at the last poll window.
   * Sideloads `users` (see `fetchTicketsPage`) for the same requester-name
   * resolution the incremental-export path gets.
   */
  fetchTicket(ticketId: number): Promise<ZendeskTicketShow> {
    return this.request<ZendeskTicketShow>(`/api/v2/tickets/${ticketId}.json?include=users`);
  }

  /** https://developer.zendesk.com/api-reference/ticketing/business-hours/schedules/ — accounts have few schedules, so Zendesk returns them unpaginated. */
  fetchBusinessHoursSchedules(): Promise<ZendeskBusinessHoursSchedulesPage> {
    return this.request<ZendeskBusinessHoursSchedulesPage>("/api/v2/business_hours/schedules.json");
  }

  fetchScheduleHolidaysPage(scheduleId: number, nextPageUrl?: string): Promise<ZendeskScheduleHolidaysPage> {
    return this.request<ZendeskScheduleHolidaysPage>(
      nextPageUrl ?? `/api/v2/business_hours/schedules/${scheduleId}/holidays.json`,
    );
  }
}
