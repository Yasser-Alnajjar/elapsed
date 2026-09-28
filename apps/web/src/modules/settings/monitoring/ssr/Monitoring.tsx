import { Actions } from "@/actions";
import { getLiveDataStatusView } from "@/lib/live-data-status-data";
import { MonitoringView } from "../csr/MonitoringView";

export const Monitoring = async () => {
  const data = await Actions.WorkerSettings.getData();
  const liveData = getLiveDataStatusView();

  return <MonitoringView data={data} liveData={liveData} />;
};
