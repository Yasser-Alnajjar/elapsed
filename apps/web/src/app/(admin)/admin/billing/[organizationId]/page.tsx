import { TenantBilling } from "@modules/admin/tenant-billing";

export const dynamic = "force-dynamic";

export default async function AdminTenantBillingPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <TenantBilling organizationId={organizationId} />;
}
