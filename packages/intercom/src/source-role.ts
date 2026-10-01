import type { SourceRole } from "@sla/core";

/** The role this provider's events play in a case. the adapter record carries it too. */
export const INTERCOM_SOURCE_ROLE = "ticket_source" satisfies SourceRole;
