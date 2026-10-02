import { TenantDetail } from "@modules/admin/tenant-detail";

export const dynamic = "force-dynamic";

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <TenantDetail organizationId={organizationId} />;
}
