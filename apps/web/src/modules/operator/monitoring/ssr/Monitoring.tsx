import { Actions } from "@/actions";
import { getLiveDataStatusView } from "@/lib/live-data-status-data";
import { MonitoringView } from "../csr/MonitoringView";

export const Monitoring = async () => {
  // Operator-only: `getMonitoringData` calls `notFound()` for anyone else
  // before either read below happens.
  const data = await Actions.WorkerSettings.getMonitoringData();
  const liveData = getLiveDataStatusView();

  return <MonitoringView data={data} liveData={liveData} />;
};
