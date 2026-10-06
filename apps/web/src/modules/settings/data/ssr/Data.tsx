import { Actions } from "@/actions";
import { DataView } from "../csr/DataView";

export const Data = async () => {
  const data = await Actions.Data.getData();
  return <DataView data={data} />;
};
