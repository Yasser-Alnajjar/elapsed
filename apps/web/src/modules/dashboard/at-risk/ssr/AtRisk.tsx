import { Actions } from "@/actions";
import { parseAtRiskParams } from "@/lib/at-risk-data";
import { AtRiskView } from "../csr/AtRiskView";
import { SlaAutoRefreshProvider } from "@/components/shared/SlaAutoRefreshProvider";

interface AtRiskProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export const AtRisk = async ({ searchParams }: AtRiskProps) => {
  const params = parseAtRiskParams(searchParams);

  const [data, worker] = await Promise.all([
    Actions.AtRisk.getData(params),
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
