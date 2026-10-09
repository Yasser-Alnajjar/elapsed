import { Actions } from "@/actions";
import { CustomProviderView } from "../csr/CustomProviderView";

export const CustomProvider = async () => {
  const data = await Actions.CustomProvider.getPageData();
  return <CustomProviderView data={data} />;
};
