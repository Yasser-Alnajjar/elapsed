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
  mass_deletion:
    "A sync was stopped before any change was applied because it would have removed an unusually large share of your tickets (by a deleted or archived status or flag, or because tickets no longer exist at the source). Nothing was deleted and this check cannot be overridden from here. If the removal is intended, contact support; if not, fix the source and the next sync will retry.",
  live_case_ceiling:
    "A sync was stopped before any change was applied because it would take this source over the number of live tickets Elapsed supports for one custom source during the Beta. Nothing was changed. Narrow the tickets the listing returns (for example, by status or date), then the next sync will retry.",
  mass_record_failure:
    "A sync was stopped before any change was applied because too many tickets in the batch could not be processed. Nothing was changed. Review the failed tickets below and fix the field mappings or the data; the next sync will retry.",
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

/** Why one ticket could not be imported. Codes carry no ticket data, so these say what to check, not what the value was. */
export const MAPPING_ERROR_COPY: Record<string, string> = {
  invalid_path: "A field path in your mapping is not valid.",
  missing_required: "A required field (such as the ticket or comment ID) was empty in your API's response. Check the field mapping.",
  invalid_type: "A mapped field has an unexpected type, for example an object or list where text was expected. Check the path in the field mapping.",
  invalid_date: "A date could not be read. Check the date format in your mapping.",
  date_format_required: "A date value needs a format in your mapping.",
  timezone_required: "A date without a time zone was found. Set a time zone in the Fields step.",
  invalid_timezone: "The time zone in your configuration is not recognised.",
  nonexistent_local_time: "A local time falls in a daylight-saving gap and does not exist in the configured time zone.",
  ambiguous_local_time: "A local time occurs twice because of a daylight-saving change in the configured time zone.",
  unknown_status: "The ticket has a status that is not in your status mapping. Add it, or choose a fallback for unknown statuses.",
  unknown_priority: "The ticket has a priority that is not in your priority mapping.",
  unknown_author_role: "A comment author's role is not in your author role mapping.",
  unknown_visibility: "A comment's public/private value is not in your visibility mapping.",
  creation_actor_unknown: "Could not tell who created the ticket. Check the ticket creator setting on the Replies and SLA step.",
  payload_too_large: "The ticket and its comments or history are too large to import.",
  duplicate_id: "Another ticket in the same sync has this ID.",
  unsafe_id: "The ticket ID is too long or contains control characters.",
  comments_not_found: "Your API returned 404 (not found) for this ticket's comments. Check the comments path on the Replies and SLA step, or the ticket was deleted.",
  history_not_found: "Your API returned 404 (not found) for this ticket's status history. Check the status history path, or the ticket was deleted.",
  transform_failed: "A mapped value could not be built: a template uses a value that is not defined, or a text value is too long.",
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
