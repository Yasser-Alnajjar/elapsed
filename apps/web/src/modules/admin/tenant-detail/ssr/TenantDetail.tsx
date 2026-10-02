import { AdminActions } from "@/actions/admin";
import { TenantDetailView } from "../csr/TenantDetailView";

export const TenantDetail = async ({ organizationId }: { organizationId: string }) => {
  // Audited as `view_tenant`; `notFound()` for an unknown organization.
  const data = await AdminActions.getTenantDetail(organizationId);

  return <TenantDetailView data={data} />;
};
