/**
 * Minimal shapes for the fields this adapter actually reads off Linear's
 * GraphQL API (https://api.linear.app/graphql). Not full schema coverage —
 * extend as the normalizer and correlator (roadmap step 15) need more.
 */

/**
 * Linear's OAuth access tokens do not carry a refresh token — unlike Jira,
 * there is no expiry/refresh dance to manage here. If a token is ever
 * revoked, the only recovery path is the user reconnecting (`reauthRequired`).
 */
export interface LinearCredentials {
  accessToken: string;
  tokenType: string;
  scope: string;
  /** Set when a request 401s and there is no refresh path. Cleared automatically on reconnect. */
  reauthRequired?: boolean;
}

/** A Linear workflow state, embedded wherever it's referenced — see LinearIssue.state. */
export interface LinearWorkflowState {
  id: string;
  name: string;
  /** Linear's fixed vocabulary: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled". */
  type: string;
}

export interface LinearIssue {
  id: string;
  /** Human-readable key like "ENG-123", used only for display — API calls key off `id`. */
  identifier: string;
  title: string;
  url: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  state: LinearWorkflowState;
  team: { id: string; key: string; name: string };
  creator: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
}

export interface LinearPageInfo {
  hasNextPage: boolean;
  endCursor?: string;
}

export interface LinearIssueConnection {
  nodes: LinearIssue[];
  pageInfo: LinearPageInfo;
}

/**
 * One entry in an issue's history — Linear's event log. An entry can be
 * rewritten in place (Linear coalesces rapid state changes by the same actor
 * into one entry), so the same id may be seen with different content; the
 * RawEvent key therefore carries a content hash.
 * A rewrite keeps `id`, `createdAt` and `fromState` but advances `updatedAt`
 * (and replaces `toState`), so `updatedAt` is what keeps the hash distinct when
 * the state returns to one already seen (A → B → A) — without it the third
 * version hashes identically to the first and is dropped as a duplicate.
 * `updatedAt` is absent on rows fetched before it was queried.
 * `fromState`/`toState` embed the full workflow state (including `type`)
 * directly, unlike Jira's changelog which only gives a status name/id —
 * so, unlike the Jira adapter, there is no need for a separate site-wide
 * status lookup to recover the fixed-vocabulary category later.
 */
export interface LinearHistoryEntry {
  id: string;
  createdAt: string;
  updatedAt?: string;
  actor: { id: string; name: string } | null;
  fromState: LinearWorkflowState | null;
  toState: LinearWorkflowState | null;
}

export interface LinearHistoryConnection {
  nodes: LinearHistoryEntry[];
  pageInfo: LinearPageInfo;
}

/**
 * A link attached to an issue — populated by the official Zendesk-Linear
 * integration, another linked resource, or manually by a user. `url`
 * pointing at a Zendesk ticket is the deterministic correlation signal the
 * roadmap step 15 correlator reads (Phase 15), mirroring Jira's remote links.
 */
export interface LinearAttachment {
  id: string;
  url: string;
  title: string;
  subtitle?: string | null;
  sourceType?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinearAttachmentConnection {
  nodes: LinearAttachment[];
  pageInfo: LinearPageInfo;
}

/**
 * Persisted in Integration.cursor. Resumable across backfill runs, mirroring
 * JiraCursor: `updatedSince` is the watermark for the issue stream, `after`
 * resumes mid-page within that watermark via Linear's opaque cursor
 * pagination, and both advance only after a page's issues (and their
 * history/attachments) have been written as RawEvents. Absent `after` means
 * "start of this watermark's result set."
 */
export interface LinearCursor {
  issues?: { updatedSince: string /* ISO 8601 */; after?: string };
  backfillCompletedAt?: string; // ISO 8601
}
