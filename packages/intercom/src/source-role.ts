import type { SourceRole } from "@sla/core";

/** The role this provider's events play in a case. the adapter record carries it too. */
export const INTERCOM_SOURCE_ROLE = "ticket_source" satisfies SourceRole;

/** Role of the Jira `issue_linked` / `issue_unlinked` events the Intercom correlator writes onto a case. */
export const INTERCOM_JIRA_LINK_EVENT_SOURCE_ROLE = "work_tracker" satisfies SourceRole;
