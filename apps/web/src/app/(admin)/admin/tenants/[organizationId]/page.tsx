import { TenantDetail } from "@modules/admin/tenant-detail";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Tenant details");

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <TenantDetail organizationId={organizationId} />;
}
