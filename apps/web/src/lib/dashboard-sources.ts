import type { SourceRole } from "@sla/core";
import type { DashboardSourceConnection, DashboardSourceStatus } from "./types/dashboard";
import {
  INTEGRATION_PROVIDER_LABELS,
  type IntegrationConnectionView,
  type IntegrationProvider,
} from "./types/integrations";

// A role the dashboard cannot do without gets a "Not connected" placeholder
// when nothing fills it; a code host is an optional extra and just disappears.
const REQUIRED_ROLE_LABELS: Partial<Record<SourceRole, string>> = {
  ticket_source: "Ticket source",
  work_tracker: "Work tracker",
};
const ROLE_ORDER: SourceRole[] = ["ticket_source", "work_tracker", "code_host"];

/**
 * The status bar's connections, built from each provider's own `role` and the
 * label registry, never from a provider name: every connected provider is
 * listed, so a new integration appears here with no change.
 */
export function dashboardSourceStatus(
  views: Record<IntegrationProvider, Pick<IntegrationConnectionView, "role" | "connected">>,
): DashboardSourceStatus {
  const providers = Object.keys(INTEGRATION_PROVIDER_LABELS) as IntegrationProvider[];
  return ROLE_ORDER.flatMap((role): DashboardSourceConnection[] => {
    const connected = providers.filter((p) => views[p].role === role && views[p].connected);
    if (connected.length > 0) {
      return connected.map((p) => ({ label: INTEGRATION_PROVIDER_LABELS[p], connected: true, role }));
    }
    const placeholder = REQUIRED_ROLE_LABELS[role];
    return placeholder ? [{ label: placeholder, connected: false, role }] : [];
  });
}
