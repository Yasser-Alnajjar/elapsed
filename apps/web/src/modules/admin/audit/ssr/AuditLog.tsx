import { AdminActions } from "@/actions/admin";
import { parseAuditCursor, parseAuditFilters, type AuditSearchParams } from "@/lib/admin-audit-filters";
import { AuditLogView } from "../csr/AuditLogView";

export const AuditLog = async ({ params }: { params: AuditSearchParams }) => {
  const before = parseAuditCursor(params);
  const filters = parseAuditFilters(params);
  const data = await AdminActions.getAuditLog(before, filters);

  return <AuditLogView data={data} filters={filters} isFirstPage={before === null} />;
};
