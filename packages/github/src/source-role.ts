import type { SourceRole } from "@sla/core";

/** The role this provider's events play in a case. N2 moves this into the adapter record. */
export const GITHUB_SOURCE_ROLE = "code_host" satisfies SourceRole;
