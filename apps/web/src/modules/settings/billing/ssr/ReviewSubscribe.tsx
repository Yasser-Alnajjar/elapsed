import { redirect } from "next/navigation";
import { isPlanId } from "@sla/db/plans";
import { Actions } from "@/actions";
import { resolveSubscribeReview } from "@/lib/billing-subscribe";
import { SubscribeView } from "../csr/subscribe/SubscribeView";

export const ReviewSubscribe = async ({ plan }: { plan?: string }) => {
  // The pricing page is where a plan is chosen; a missing or unknown one goes back there.
  if (!isPlanId(plan)) redirect("/pricing");

  const data = await Actions.Billing.getData();

  return <SubscribeView review={resolveSubscribeReview(data, plan)} />;
};
