import { Actions } from "@/actions";
import { parseCaseListParams } from "@/lib/case-list-data";
import { CaseListView } from "../csr/list-view";

interface CaseListProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export const CaseList = async ({ searchParams }: CaseListProps) => {
  const params = parseCaseListParams(searchParams);
  const data = await Actions.Cases.getList(params);

  return <CaseListView data={data} />;
};
