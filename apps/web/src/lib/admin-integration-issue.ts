import { formatSpan, formatUtcTimestamp } from "./admin-format";
import type { OperatorIntegrationHealthRow } from "./types/operator";

export interface IntegrationIssueFact {
  label: string;
  value: string;
  /** Emphasis for the one fact that explains the state (e.g. when it started failing). */
  tone?: "danger" | "warning";
}

/** What an operator reads for one unhealthy integration: a state word, a headline, the facts, and the provider's error if any. */
export interface IntegrationIssue {
  /** Danger: data is not being kept current by accident. Warning: stale or paused, which an operator may have done on purpose. */
  tone: "danger" | "warning";
  label: string;
  headline: string;
  /** Plain-language effect on the customer, when the state has one. */
  note: string | null;
  facts: IntegrationIssueFact[];
  /** The provider's last error text. Operator-visible; never a credential. */
  error: string | null;
}

/**
 * The overview's one explanation per unhealthy integration. Order matters: a
 * deliberate pause explains the staleness, so it wins over "stale"; a lost
 * authorization explains the failures, so it wins over "failing".
 */
export function describeIntegrationIssue(row: OperatorIntegrationHealthRow): IntegrationIssue {
  const lastClean: IntegrationIssueFact = { label: "Last clean sync", value: formatUtcTimestamp(row.lastSuccessfulSyncAt) };
  const lastAttempt: IntegrationIssueFact = { label: "Last attempt", value: formatUtcTimestamp(row.lastSyncAt) };

  if (row.pollingPausedAt) {
    return {
      tone: "warning",
      label: "Paused by operator",
      headline: "Polling was paused on purpose",
      note: "The customer sees this integration as stale, and breach alerts for its cases are held until polling resumes.",
      facts: [{ label: "Paused since", value: formatUtcTimestamp(row.pollingPausedAt), tone: "warning" }, lastClean],
      error: null,
    };
  }

  if (row.reauthRequired) {
    return {
      tone: "danger",
      label: "Needs reconnect",
      headline: "Re-authentication required",
      note: "The saved authorization no longer works. The customer has to reconnect this integration.",
      facts: [lastAttempt, lastClean],
      error: row.lastSyncError,
    };
  }

  if (row.permissionDenied) {
    return {
      tone: "danger",
      label: "Access lost",
      headline: "Provider-side access lost (permission denied)",
      note: "The token still works, but the person who connected it lost access inside the provider.",
      facts: [lastAttempt, lastClean],
      error: row.lastSyncError,
    };
  }

  if (row.failingSince) {
    return {
      tone: "danger",
      label: "Failing",
      headline: `${row.consecutiveFailures} consecutive failed attempt${row.consecutiveFailures === 1 ? "" : "s"}`,
      note: null,
      facts: [
        { label: "Failing since", value: formatUtcTimestamp(row.failingSince), tone: "danger" },
        {
          label: "Attempts",
          value: `${row.consecutiveFailures}${row.lastSyncDurationMs === null ? "" : ` · last took ${formatSpan(row.lastSyncDurationMs)}`}`,
        },
        lastClean,
      ],
      error: row.lastSyncError,
    };
  }

  if (row.lastSyncError) {
    return {
      tone: "danger",
      label: "Sync failed",
      headline: "The last sync failed",
      note: null,
      facts: [lastAttempt, lastClean],
      error: row.lastSyncError,
    };
  }

  return {
    tone: "warning",
    label: "Stale",
    headline: row.staleSince ? "No recent successful sync" : "No successful sync has completed yet",
    note: null,
    facts: [
      row.staleSince
        ? { label: "Stale since", value: formatUtcTimestamp(row.staleSince), tone: "warning" }
        : { label: "Stale since", value: "Never synced", tone: "warning" },
      lastAttempt,
      lastClean,
    ],
    error: null,
  };
}
