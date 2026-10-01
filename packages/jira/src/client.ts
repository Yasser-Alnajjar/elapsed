import { fetchWithRetry } from "@sla/http-retry";
import type { JiraChangelogPage, JiraCredentials, JiraIssue, JiraRemoteLink, JiraSearchPage, JiraStatus } from "./types";
import { PERMISSION_DENIED_BRAND } from "@sla/ingestion";

const SEARCH_PAGE_SIZE = 100;

export class JiraApiError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`Jira API error ${status} for ${url}`);
    this.name = "JiraApiError";
    this.status = status;
  }
}

/**
 * A 403: the token is still valid, but the user who connected the
 * integration can no longer read what was asked for (project/site access
 * revoked on Atlassian's side). Distinct from a 401 — reconnecting would mint
 * the same user's token with the same permissions, so the fix is restoring
 * that user's access in Jira, not a new OAuth grant. Subclasses
 * `JiraApiError` so existing `status` checks keep working.
 */
export class JiraPermissionDeniedError extends JiraApiError {
  readonly [PERMISSION_DENIED_BRAND] = true as const;
  constructor(url: string) {
    super(403, url);
    this.name = "JiraPermissionDeniedError";
  }
}

export interface JiraClientOptions {
  /**
   * Called at most once per request when Jira responds 401. Receives the
   * credentials that were just rejected (so the caller can tell whether
   * another process already rotated them) and must return credentials to
   * retry with. Throwing here (e.g. a reauth-required error) aborts the retry.
   */
  onUnauthorized?: (failedCredentials: JiraCredentials) => Promise<JiraCredentials>;
}

/** Thin, provider-aware fetch wrapper. Everything past this file is provider-agnostic. */
export class JiraClient {
  private credentials: JiraCredentials;
  private readonly onUnauthorized?: (failedCredentials: JiraCredentials) => Promise<JiraCredentials>;

  constructor(credentials: JiraCredentials, options: JiraClientOptions = {}) {
    this.credentials = credentials;
    this.onUnauthorized = options.onUnauthorized;
  }

  private baseUrl(): string {
    return `https://api.atlassian.com/ex/jira/${this.credentials.cloudId}`;
  }

  private async request<T>(path: string, hasRetriedAuth = false): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl()}${path}`;
    const response = await fetchWithRetry(
      () =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            Accept: "application/json",
          },
        }),
      { isRetryableStatus: (r) => r.status === 429 },
    );

    if (response.status === 401 && this.onUnauthorized && !hasRetriedAuth) {
      this.credentials = await this.onUnauthorized(this.credentials);
      return this.request<T>(path, true);
    }

    if (response.status === 403) {
      throw new JiraPermissionDeniedError(url);
    }

    if (!response.ok) {
      throw new JiraApiError(response.status, url);
    }

    return (await response.json()) as T;
  }

  /**
   * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get
   * The legacy /rest/api/3/search (startAt/total) was removed by Atlassian
   * in 2025 — this is the enhanced JQL search, paginated by token.
   */
  searchIssues(jql: string, nextPageToken?: string): Promise<JiraSearchPage> {
    const params = new URLSearchParams({
      jql,
      maxResults: String(SEARCH_PAGE_SIZE),
      fields: "summary,status,priority,project,created,updated,reporter,assignee",
    });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);
    return this.request<JiraSearchPage>(`/rest/api/3/search/jql?${params.toString()}`);
  }

  /**
   * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-get
   * Single-issue fetch for a targeted refetch (roadmap step 20's webhook
   * receiver) — same field set as searchIssues, so downstream mapping/
   * normalization sees an identical shape whether an issue arrived via poll
   * or webhook.
   */
  fetchIssue(issueIdOrKey: string): Promise<JiraIssue> {
    const params = new URLSearchParams({ fields: "summary,status,priority,project,created,updated,reporter,assignee" });
    return this.request<JiraIssue>(`/rest/api/3/issue/${issueIdOrKey}?${params.toString()}`);
  }

  /** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-changelogs/ */
  fetchChangelogPage(issueIdOrKey: string, startAt = 0): Promise<JiraChangelogPage> {
    const params = new URLSearchParams({ startAt: String(startAt), maxResults: "100" });
    return this.request<JiraChangelogPage>(`/rest/api/3/issue/${issueIdOrKey}/changelog?${params.toString()}`);
  }

  /** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-remote-links/ */
  fetchRemoteLinks(issueIdOrKey: string): Promise<JiraRemoteLink[]> {
    return this.request<JiraRemoteLink[]>(`/rest/api/3/issue/${issueIdOrKey}/remotelink`);
  }

  /**
   * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-statuses/#api-rest-api-3-status-get
   * The site-wide status list — small (tens, not thousands), unpaginated.
   */
  fetchStatuses(): Promise<JiraStatus[]> {
    return this.request<JiraStatus[]>("/rest/api/3/status");
  }
}
