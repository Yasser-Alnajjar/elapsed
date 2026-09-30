import type { SourceRole } from "@sla/core";

/** The role this provider's events play in a case. N2 moves this into the adapter record. */
export const ZENDESK_SOURCE_ROLE = "ticket_source" satisfies SourceRole;

/** Role of the Jira `issue_linked` / `issue_unlinked` events the Zendesk correlator writes onto a case (N1.13 makes link resolution generic). */
export const JIRA_LINK_EVENT_SOURCE_ROLE = "work_tracker" satisfies SourceRole;
