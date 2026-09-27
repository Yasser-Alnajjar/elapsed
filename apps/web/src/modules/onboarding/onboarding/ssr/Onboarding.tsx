import { Actions } from "@/actions";
import { OnboardingFlow } from "../csr/OnboardingFlow";

export const Onboarding = async () => {
  const { status, zendeskSubdomain } = await Actions.Onboarding.getData();

  return (
    <OnboardingFlow initialStatus={status} zendeskSubdomain={zendeskSubdomain} />
  );
};
