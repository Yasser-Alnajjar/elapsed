import { AdminActions } from "@/actions/admin";
import { BillingOverviewView } from "../csr/BillingOverviewView";

export const BillingOverview = async () => {
  const data = await AdminActions.getBillingOverview();

  return <BillingOverviewView data={data} />;
};
