import { TenantBilling } from "@modules/admin/tenant-billing";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Organization billing");

export default async function AdminTenantBillingPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <TenantBilling organizationId={organizationId} />;
}
