import type { AttentionCause, CustomSyncState } from "./status";

/**
 * Customer-facing wording for the Custom REST sync states (plan 09, 6.13).
 * DRAFT copy: it is verified against the implementation in N9.14 and never
 * states a supported capacity. A long import is never described as a failure,
 * and a failure is never described as a slow import.
 */
export interface StateCopy {
  title: string;
  tone: "neutral" | "success" | "error";
  /** What the customer sees. */
  body: string;
}

export const STATE_COPY: Record<CustomSyncState, StateCopy> = {
  importing_history: {
    title: "Importing your history",
    tone: "neutral",
    body: "Elapsed has not yet read all of your tickets. SLA clocks and breach alerts start after the first complete import. This can take a while for a large history and is not a fault.",
  },
  catching_up: {
    title: "Catching up",
    tone: "neutral",
    body: "Your system returned more changes than one sync can read, so Elapsed is reading them over several syncs. Your data is current only through the last completed sync.",
  },
  up_to_date: {
    title: "Up to date",
    tone: "success",
    body: "The latest sync completed and your data is current.",
  },
  needs_attention: {
    title: "Needs attention",
    tone: "error",
    body: "Elapsed could not complete a sync.",
  },
  paused: {
    title: "Paused",
    tone: "neutral",
    body: "Syncing is paused by the platform operator. Your existing data stays visible and monitored but no new data arrives until it resumes.",
  },
  disabled: {
    title: "Not enabled",
    tone: "neutral",
    body: "Custom REST is not enabled for your organization. Your existing data stays visible and monitored but no new data arrives.",
  },
};

export const ATTENTION_COPY: Record<AttentionCause, string> = {
  reconnect: "Your credentials were rejected by your system. Enter them again.",
  credentials: "Your saved credentials are unavailable. Enter them again.",
  permission: "Your system denied access. Check the permissions of the account the credentials belong to.",
  provider: "Your system could not be reached or answered with an error. Elapsed retries on every sync.",
  safety_check: "A safety check stopped a sync before any change was applied. Review the flagged change below.",
  no_progress: "Elapsed could not read even one page in three syncs in a row. Check that your system responds in time, or narrow the first import.",
  cannot_finish_without_cursor:
    "Your system has no way to ask for only recent changes, and a full listing no longer fits in one sync. Add an updated-since parameter to the configuration.",
  processing: "A sync failed while processing your tickets. Elapsed retries on every sync.",
};

/** Notices for what a source cannot support (plan 09, 5.4). Never claims full historical accuracy. */
export const LIMITATION_COPY: Record<string, string> = {
  no_status_history:
    "This source does not provide status history, so Elapsed uses only each ticket's current status and the timestamps your system supplies. It does not reconstruct history: time a ticket spent waiting on the customer cannot be excluded, and a ticket closed and reopened between syncs may be missed, so resolution times can read longer than your system's own.",
};

export const UNSUPPORTED_KIND_COPY: Record<string, string> = {
  first_response: "First response is not supported for this source.",
  next_reply: "Next reply is not supported for this source.",
  resolution: "Resolution is not supported for this source.",
};

export const REASON_COPY: Record<string, string> = {
  no_comments_source: "No comments source is configured.",
  no_author_role_mapping: "The comment author role is not mapped.",
  comment_visibility_not_acknowledged: "No public/private field is mapped and you have not confirmed that every comment is customer-visible.",
  no_creation_actor: "It is not defined who creates a ticket.",
  resolution_only_mode: "This integration is set to Resolution-only.",
  no_terminal_status_mapped: "No status is mapped to resolved or closed.",
  no_closure_timestamp: "Your system does not supply a closure timestamp for resolved tickets.",
  no_status_history_customer_wait_not_applied: "Customer waiting time cannot be excluded without status history.",
  reopen_detection_limited: "Reopened tickets can only be detected from the current status.",
};
