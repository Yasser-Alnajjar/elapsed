import { AdminActions } from "@/actions/admin";
import { TenantBillingView } from "../csr/TenantBillingView";

export const TenantBilling = async ({ organizationId }: { organizationId: string }) => {
  const data = await AdminActions.getTenantBilling(organizationId);

  return <TenantBillingView data={data} />;
};
