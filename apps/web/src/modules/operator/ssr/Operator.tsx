import { Actions } from "@/actions";
import { OperatorView } from "../csr/OperatorView";

export const Operator = async () => {
  const data = await Actions.Operator.getData();

  return <OperatorView data={data} />;
};
