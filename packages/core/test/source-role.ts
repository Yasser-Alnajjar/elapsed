import type { NormalizedEvent, SourceRole } from "../src/types";

/**
 * The role a test fixture's `system` implies, so legacy fixtures that only name
 * a provider still carry a `sourceRole` (N1.5). Fixtures that need a role the
 * system doesn't imply pass `sourceRole` explicitly.
 */
export function roleOf(system: string): SourceRole {
  if (system === "zendesk" || system === "intercom") return "ticket_source";
  if (system === "jira" || system === "linear") return "work_tracker";
  if (system === "github") return "code_host";
  throw new Error(`No default sourceRole for system "${system}"`);
}

export function withSourceRole<T extends Omit<NormalizedEvent, "sourceRole"> & { sourceRole?: SourceRole }>(
  event: T,
): T & { sourceRole: SourceRole } {
  return { ...event, sourceRole: event.sourceRole ?? roleOf(event.system) };
}
