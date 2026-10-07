import { Tenants } from "@modules/admin/tenants";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Tenants");

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <Tenants query={q ?? ""} />;
}
