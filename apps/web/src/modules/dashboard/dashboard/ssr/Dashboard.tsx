import { Actions } from "@/actions";

import { DashboardView } from "../csr/DashboardView";

/**
 * `AppShell` is itself an async server component (it reads the session
 * directly for the user menu), so it's composed here rather than inside the
 * "use client" view — nesting it in the CSR layer would drag `@sla/db` into
 * the browser bundle.
 */
export const Dashboard = async () => {
  const [data, integrations] = await Promise.all([
    Actions.Dashboard.getData(),
    Actions.Integrations.getData(),
  ]);

  return (
    <>
      <DashboardView
        data={data}
        autoSyncSeconds={5}
        sourceStatus={{
          // Name whichever ticket source / tracker is actually connected
          // (Intercom and Linear are alternatives, not add-ons).
          ticketSource:
            !integrations.zendesk.connected && integrations.intercom.connected
              ? { label: "Intercom", connected: true }
              : { label: "Zendesk", connected: integrations.zendesk.connected },
          tracker:
            !integrations.jira.connected && integrations.linear.connected
              ? { label: "Linear", connected: true }
              : { label: "Jira", connected: integrations.jira.connected },
        }}
      />
    </>
  );
};
