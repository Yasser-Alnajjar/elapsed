import { ReviewPolicies } from "@modules/onboarding/review-policies";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Review SLA policies");

export default function ReviewPoliciesPage() {
  return <ReviewPolicies />;
}
