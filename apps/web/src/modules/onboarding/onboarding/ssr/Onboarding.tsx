import { Actions } from "@/actions";
import { OnboardingFlow } from "../csr/OnboardingFlow";

export const Onboarding = async () => {
  const { status } = await Actions.Onboarding.getData();

  return <OnboardingFlow initialStatus={status} />;
};
