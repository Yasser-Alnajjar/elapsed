import { Actions } from "@/actions";
import { AtRiskView } from "../csr/AtRiskView";
import { SlaAutoRefreshProvider } from "@/components/shared/SlaAutoRefreshProvider";

export const AtRisk = async () => {
  const [data, worker] = await Promise.all([
    Actions.AtRisk.getData(),
    Actions.WorkerSettings.getData(),
  ]);

  return (
    <>
      <AtRiskView data={data} />
      <SlaAutoRefreshProvider
        initInterval={worker.activePollIntervalMs - 2000}
      />
    </>
  );
};
