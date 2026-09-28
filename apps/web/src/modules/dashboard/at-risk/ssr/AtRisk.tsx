import { Actions } from "@/actions";
import { parseAtRiskParams } from "@/lib/at-risk-data";
import { AtRiskView } from "../csr/AtRiskView";

interface AtRiskProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export const AtRisk = async ({ searchParams }: AtRiskProps) => {
  const params = parseAtRiskParams(searchParams);

  const data = await Actions.AtRisk.getData(params);

  // Live refresh (LiveDataProvider) is mounted globally in (main)/layout.tsx.
  return <AtRiskView data={data} />;
};
