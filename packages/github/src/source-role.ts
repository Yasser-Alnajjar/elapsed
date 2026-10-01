import type { SourceRole } from "@sla/core";

/** The role this provider's events play in a case; the adapter record carries it too. */
export const GITHUB_SOURCE_ROLE = "code_host" satisfies SourceRole;
