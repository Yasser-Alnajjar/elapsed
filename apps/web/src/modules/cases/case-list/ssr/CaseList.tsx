import { Actions } from "@/actions";
import { SlaAutoRefreshProvider } from "@/components/shared/SlaAutoRefreshProvider";
import { CaseListView } from "../csr/list-view";

export const CaseList = async () => {
  const [data] = await Promise.all([
    Actions.Cases.getList(),
    // Actions.WorkerSettings.getData(),
  ]);

  return (
    <>
      <CaseListView data={data} />
      {/* <SlaAutoRefreshProvider
        initInterval={worker.activePollIntervalMs - 2000}
      /> */}
    </>
  );
};
