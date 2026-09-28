import { Actions } from "@/actions";
import { CaseDetailView } from "../csr/CaseDetailView";
import { SlaAutoRefreshProvider } from "@/components/shared/SlaAutoRefreshProvider";

export const CaseDetail = async ({
  caseId,
  commitmentId,
}: {
  caseId: string;
  /** The commitment the user navigated from; ignored unless it belongs to this case. */
  commitmentId?: string;
}) => {
  const [data, worker] = await Promise.all([
    Actions.Cases.getDetail(caseId),
    Actions.WorkerSettings.getData(),
  ]);

  const selectedCommitmentId =
    data.commitments.find((c) => c.id === commitmentId)?.id ?? null;

  return (
    <>
      <CaseDetailView data={data} selectedCommitmentId={selectedCommitmentId} />
      <SlaAutoRefreshProvider
        initInterval={worker.activePollIntervalMs - 2000}
      />
    </>
  );
};
