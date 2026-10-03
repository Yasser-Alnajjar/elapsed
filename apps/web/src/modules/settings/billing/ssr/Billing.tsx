import { Actions } from "@/actions";
import { isBillingTab } from "@/lib/types/billing";
import { BillingView } from "../csr/BillingView";

export const Billing = async ({ tab }: { tab?: string }) => {
  const data = await Actions.Billing.getData();

  return <BillingView data={data} tab={isBillingTab(tab) ? tab : "overview"} />;
};
