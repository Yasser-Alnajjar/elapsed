import { Actions } from "@/actions";
import { dashboardSourceStatus } from "@/lib/dashboard-sources";

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
      sourceStatus={dashboardSourceStatus(integrations)}
    />
  );
};
