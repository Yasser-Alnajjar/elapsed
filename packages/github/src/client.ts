import { fetchWithRetry } from "@sla/http-retry";
import type {
  GithubCredentials,
  GithubPageInfo,
  GithubPullRequest,
  GithubPullRequestConnection,
  GithubTimelineConnection,
  GithubTimelineItem,
} from "./types";
import { PERMISSION_DENIED_BRAND } from "@sla/ingestion";

const API_URL = "https://api.github.com/graphql";
const PAGE_SIZE = 100;

export class GithubApiError extends Error {
  readonly status: number;
  readonly errors?: unknown;

  constructor(status: number, message: string, errors?: unknown) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
    this.errors = errors;
  }
}

/**
 * The token is still valid, but the user who connected the integration can
 * no longer read the repository (removed from it, or an org's SAML SSO
 * enforcement now blocks the token). Distinct from a 401 — reconnecting would
 * mint the same user's token with the same access, so the fix is restoring
 * that user's access in GitHub, not a new OAuth grant. Subclasses
 * `GithubApiError` so existing `status` checks keep working.
 */
export class GithubPermissionDeniedError extends GithubApiError {
  readonly [PERMISSION_DENIED_BRAND] = true as const;
  constructor(status: number, errors?: unknown) {
    super(status, "GitHub denied access to this repository", errors);
    this.name = "GithubPermissionDeniedError";
  }
}

/** GraphQL error `type`s GitHub uses for access problems — returned with HTTP 200, not a 403. */
const PERMISSION_ERROR_TYPES = new Set(["FORBIDDEN", "INSUFFICIENT_SCOPES"]);

function isPermissionGraphqlError(errors: unknown): boolean {
  return (
    Array.isArray(errors) &&
    errors.some((error) => PERMISSION_ERROR_TYPES.has((error as { type?: unknown } | null)?.type as string))
  );
}

export interface GithubClientOptions {
  /**
   * Called at most once per request when GitHub responds 401. Receives the
   * credentials that were just rejected (so the caller can tell whether
   * another process already rotated them) and must return credentials to
   * retry with. Throwing here (e.g. a reauth-required error) aborts the retry.
   */
  onUnauthorized?: (failedCredentials: GithubCredentials) => Promise<GithubCredentials>;
}

const REPOSITORY_ACCESS_QUERY = `
  query RepositoryAccess($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { id }
  }
`;

const SEARCH_PULL_REQUESTS_QUERY = `
  query SearchPullRequests($query: String!, $after: String) {
    search(query: $query, type: ISSUE, first: ${PAGE_SIZE}, after: $after) {
      nodes {
        ... on PullRequest {
          id
          number
          title
          url
          state
          merged
          headRefName
          createdAt
          updatedAt
          mergedAt
          closedAt
          author { login }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PULL_REQUEST_TIMELINE_QUERY = `
  query PullRequestTimeline($id: ID!, $after: String) {
    node(id: $id) {
      ... on PullRequest {
        timelineItems(
          first: ${PAGE_SIZE}
          after: $after
          itemTypes: [READY_FOR_REVIEW_EVENT, REVIEW_REQUESTED_EVENT, PULL_REQUEST_REVIEW, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT]
        ) {
          nodes {
            __typename
            ... on ReadyForReviewEvent { id createdAt actor { login } }
            ... on ReviewRequestedEvent { id createdAt actor { login } }
            ... on PullRequestReview { id createdAt actor: author { login } }
            ... on MergedEvent { id createdAt actor { login } }
            ... on ClosedEvent { id createdAt actor { login } }
            ... on ReopenedEvent { id createdAt actor { login } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

function emptyConnection<T>(): { nodes: T[]; pageInfo: GithubPageInfo } {
  return { nodes: [], pageInfo: { hasNextPage: false } };
}

/** Thin, provider-aware GraphQL client. Everything past this file is provider-agnostic. */
export class GithubClient {
  private credentials: GithubCredentials;
  private readonly onUnauthorized?: (failedCredentials: GithubCredentials) => Promise<GithubCredentials>;

  constructor(credentials: GithubCredentials, options: GithubClientOptions = {}) {
    this.credentials = credentials;
    this.onUnauthorized = options.onUnauthorized;
  }

  private async request<T>(
    query: string,
    variables: Record<string, unknown>,
    hasRetriedAuth = false,
  ): Promise<T> {
    // GitHub's secondary rate limits surface as 403 with a Retry-After
    // header, unlike Linear's plain 429 — a normal 403 (e.g. lost repo
    // access) carries no such header and falls through to the checks below.
    const response = await fetchWithRetry(
      (signal) =>
        fetch(API_URL, {
          signal,
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.credentials.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, variables }),
        }),
      { isRetryableStatus: (r) => r.status === 403 && r.headers.has("Retry-After") },
    );

    if (response.status === 401 && this.onUnauthorized && !hasRetriedAuth) {
      this.credentials = await this.onUnauthorized(this.credentials);
      return this.request<T>(query, variables, true);
    }

    // A 403 without Retry-After can still be rate limiting: primary-limit
    // exhaustion (`x-ratelimit-remaining: 0`), or a secondary limit GitHub
    // only identifies in the message body. Both stay a plain GithubApiError,
    // as before roadmap step 32 — only a non-rate-limit 403 means lost access.
    if (response.status === 403) {
      const text = await response.text();
      if (response.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(text)) {
        throw new GithubApiError(403, "GitHub API rate limit exceeded");
      }
      throw new GithubPermissionDeniedError(403);
    }

    if (!response.ok) {
      throw new GithubApiError(response.status, `GitHub API error ${response.status}`);
    }

    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (isPermissionGraphqlError(body.errors)) {
      throw new GithubPermissionDeniedError(response.status, body.errors);
    }
    if (body.errors) {
      throw new GithubApiError(response.status, "GitHub GraphQL query returned errors", body.errors);
    }
    return body.data as T;
  }

  /**
   * Confirms the token can read `owner/repo`. Search only returns results
   * from repositories a GitHub App is installed on, so without this check a
   * repo name typo or an uninstalled App would sync zero pull requests and
   * look healthy. GitHub reports an unreadable repository as `NOT_FOUND`
   * (it doesn't reveal whether a private repo exists), so that becomes a
   * `GithubPermissionDeniedError`.
   */
  async verifyRepositoryAccess(owner: string, repo: string): Promise<void> {
    try {
      const data = await this.request<{ repository: { id: string } | null }>(REPOSITORY_ACCESS_QUERY, {
        owner,
        name: repo,
      });
      if (!data.repository) throw new GithubPermissionDeniedError(200);
    } catch (error) {
      if (
        error instanceof GithubApiError &&
        !(error instanceof GithubPermissionDeniedError) &&
        Array.isArray(error.errors) &&
        error.errors.some((e) => (e as { type?: unknown } | null)?.type === "NOT_FOUND")
      ) {
        throw new GithubPermissionDeniedError(error.status, error.errors);
      }
      throw error;
    }
  }

  /**
   * GitHub's `pullRequests` connection has no native "since" filter (unlike
   * Linear's plain `updatedAt` argument), so this goes through the `search`
   * API instead — closer to Jira's JQL-windowed-search shape. Note: GitHub's
   * `updated:>=` search qualifier is date-granularity, not full ISO
   * datetime, so a watermark can re-walk part of the same day on the next
   * run — harmless, since writes dedupe via `skipDuplicates`.
   */
  async searchPullRequests(
    owner: string,
    repo: string,
    updatedSince: string,
    after?: string,
  ): Promise<GithubPullRequestConnection> {
    const sinceDate = updatedSince.slice(0, 10);
    const query = `repo:${owner}/${repo} is:pr updated:>=${sinceDate}`;
    const data = await this.request<{
      search: { nodes: (GithubPullRequest | Record<string, never>)[]; pageInfo: GithubPageInfo };
    }>(SEARCH_PULL_REQUESTS_QUERY, { query, after });

    return {
      // Non-PR search results would come back as an empty object from the
      // `... on PullRequest` fragment — filtered out, though `is:pr` in the
      // query string means this should never actually happen in practice.
      nodes: data.search.nodes.filter(
        (node): node is GithubPullRequest => typeof (node as GithubPullRequest).id === "string",
      ),
      pageInfo: data.search.pageInfo,
    };
  }

  async fetchTimelineItems(pullRequestId: string, after?: string): Promise<GithubTimelineConnection> {
    const data = await this.request<{ node: { timelineItems: GithubTimelineConnection } | null }>(
      PULL_REQUEST_TIMELINE_QUERY,
      { id: pullRequestId, after },
    );
    return data.node?.timelineItems ?? emptyConnection<GithubTimelineItem>();
  }
}
