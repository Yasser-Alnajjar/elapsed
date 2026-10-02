import { AuditLog } from "@modules/admin/audit";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AuditLog params={await searchParams} />;
}
