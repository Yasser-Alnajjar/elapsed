import { Actions } from "@/actions";
import { CaseDetailView } from "../csr/CaseDetailView";

export const CaseDetail = async ({
  caseId,
  commitmentId,
}: {
  caseId: string;
  /** The commitment the user navigated from; ignored unless it belongs to this case. */
  commitmentId?: string;
}) => {
  const data = await Actions.Cases.getDetail(caseId);

  const selectedCommitmentId =
    data.commitments.find((c) => c.id === commitmentId)?.id ?? null;

  // Live refresh (LiveDataProvider) is mounted globally in (main)/layout.tsx.
  return <CaseDetailView data={data} selectedCommitmentId={selectedCommitmentId} />;
};
