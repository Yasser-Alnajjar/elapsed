import { Actions } from "@/actions";
import { AdminActions } from "@/actions/admin";
import { OverviewView } from "../csr/OverviewView";

export const Overview = async () => {
  const [data, worker, usage] = await Promise.all([
    AdminActions.getOverview(),
    Actions.WorkerSettings.getMonitoringData(),
    AdminActions.getUsage(),
  ]);

  return <OverviewView data={data} worker={worker} usage={usage} />;
};
