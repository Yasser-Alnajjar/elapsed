import { Actions } from "@/actions";
import { AdminActions } from "@/actions/admin";
import { OverviewView } from "../csr/OverviewView";

export const Overview = async () => {
  const [data, worker] = await Promise.all([AdminActions.getOverview(), Actions.WorkerSettings.getMonitoringData()]);

  return <OverviewView data={data} worker={worker} />;
};
