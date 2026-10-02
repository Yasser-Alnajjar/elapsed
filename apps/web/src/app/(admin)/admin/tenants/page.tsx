import { Tenants } from "@modules/admin/tenants";

export const dynamic = "force-dynamic";

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <Tenants query={q ?? ""} />;
}
