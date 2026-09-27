import { Actions } from "@/actions";
import { ReviewPoliciesView } from "../csr/ReviewPoliciesView";

export const ReviewPolicies = async () => {
  const review = await Actions.Onboarding.getPolicyImportReview();

  return <ReviewPoliciesView review={review} />;
};
