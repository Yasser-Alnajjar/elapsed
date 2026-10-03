import type { SourceRole } from "@sla/core";
import type { IntegrationsPageData } from "@/lib/types/integrations";
import type { SourceIntegrationSpec } from "./source-integration-specs";

/**
 * Headings for the integrations page's groups, one per `SourceRole` — the
 * role each provider adapter already declares (`PROVIDERS[provider].role`).
 * Keyed by the role union so a new role is a compile error here until it has
 * a heading; which providers land in which group is never decided here.
 */
export const SOURCE_ROLE_GROUPS: Record<
  SourceRole,
  { title: string; description: string }
> = {
  ticket_source: {
    title: "Ticket sources",
    description: "Helpdesks that own each case's lifecycle",
  },
  work_tracker: {
    title: "Work trackers",
    description: "Engineering issues linked to cases",
  },
  code_host: {
    title: "Code hosts",
    description: "Code changes linked to cases",
  },
};

export interface SourceIntegrationGroup {
  role: SourceRole;
  specs: SourceIntegrationSpec[];
}

/**
 * Buckets the source cards by the role the page data carries for each
 * provider. Groups appear in the order their first provider appears in
 * `specs`, and cards keep their spec order within a group, so a new provider
 * shows up in its role's group with no change here.
 */
export function groupSpecsByRole(
  specs: SourceIntegrationSpec[],
  data: IntegrationsPageData,
): SourceIntegrationGroup[] {
  const groups = new Map<SourceRole, SourceIntegrationSpec[]>();
  for (const spec of specs) {
    const role = data[spec.provider].role;
    groups.set(role, [...(groups.get(role) ?? []), spec]);
  }
  return [...groups].map(([role, grouped]) => ({ role, specs: grouped }));
}
