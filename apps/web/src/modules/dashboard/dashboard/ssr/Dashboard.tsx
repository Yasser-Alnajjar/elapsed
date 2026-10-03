import { Actions } from "@/actions";

import { DashboardView } from "../csr/DashboardView";

export const Dashboard = async () => {
  const [data, integrations, activePollIntervalMs] = await Promise.all([
    Actions.Dashboard.getData(),
    Actions.Integrations.getData(),
    Actions.WorkerSettings.getActivePollIntervalMs(),
  ]);

  return (
    <DashboardView
      data={data}
      autoSyncSeconds={Math.round(activePollIntervalMs / 1000)}
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
  );
};
