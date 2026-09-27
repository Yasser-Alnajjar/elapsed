import { Actions } from "@/actions";
import { SlaAutoRefreshProvider } from "@/components/shared/SlaAutoRefreshProvider";
import { CaseListView } from "../csr/list-view";

export const CaseList = async () => {
  const data = await Actions.Cases.getList();
  const worker = await Actions.WorkerSettings.getData();

  return (
    <>
      <CaseListView data={data} pollIntervalMs={worker.activePollIntervalMs} />
      {/* <SlaAutoRefreshProvider
        initInterval={worker.activePollIntervalMs - 2000}
      /> */}
    </>
  );
};
