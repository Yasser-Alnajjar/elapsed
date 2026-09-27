import { Actions } from "@/actions";
import { ActivationView } from "../csr/ActivationView";

export const Activation = async () => {
  const data = await Actions.Onboarding.getActivationData();

  return <ActivationView data={data} />;
};
