"use client";

import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import {
  MonoLabel,
  PageHeader,
  StatTile,
} from "@/components/admin/admin-ui";
import {
  DataTableCard,
  DataTableCursorPagination,
  DataTableEmpty,
} from "@/components/shared/data-table";
import { auditQuery, hasAuditFilters } from "@/lib/admin-audit-filters";
import type {
  AdminAuditData,
  AdminAuditFilters,
  AdminAuditRow,
} from "@/lib/types/admin";
import { AuditFilterBar } from "./AuditFilterBar";
import { AuditPayloadDrawer } from "./AuditPayloadDrawer";
import { AuditTable } from "./AuditTable";

interface AuditLogViewProps {
  data: AdminAuditData;
  filters: AdminAuditFilters;
  isFirstPage: boolean;
}

/**
 * Read-only: the audit log has no edit or delete control, and none exists
 * server-side either. Every row was written in the same transaction as the
 * change it records (or, for `view_tenant`, before the data was shown).
 * Filters only choose which rows are read.
 */
export function AuditLogView({
  data,
  filters,
  isFirstPage,
}: AuditLogViewProps) {
  const [inspected, setInspected] = useState<AdminAuditRow | null>(null);

  const stats = useMemo(() => {
    const views = data.rows.filter(
      (row) => row.action === "view_tenant",
    ).length;
    return {
      events: data.rows.length,
      views,
      changes: data.rows.length - views,
      operators: new Set(data.rows.map((row) => row.actorEmail)).size,
    };
  }, [data.rows]);

  const organizationName = useMemo(
    () =>
      data.rows.find((row) => row.organizationId === filters.organizationId)
        ?.organizationName ?? null,
    [data.rows, filters.organizationId],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="border-primary/25 bg-primary/[0.06] flex items-start gap-3 rounded-lg border px-4 py-3">
        <ScrollText
          className="text-primary mt-0.5 size-5 shrink-0"
          aria-hidden
        />
        <div>
          <MonoLabel className="text-primary">Append-only record</MonoLabel>
          <p className="text-foreground mt-0.5 text-sm leading-5">
            Rows are never edited or removed, and they outlive the organizations
            they name.
          </p>
        </div>
      </div>

      <PageHeader
        breadcrumb={
          <MonoLabel>Platform administration / Security &amp; audit</MonoLabel>
        }
        title="Platform audit log"
        description="Everything a platform operator did or looked at, newest first: plan edits, polling pauses, re-normalization requests, worker settings, and every tenant opened."
      />

      <section
        aria-label="This page"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          label="Events on this page"
          value={stats.events}
          detail={hasAuditFilters(filters) ? "Filtered" : "Newest first"}
        />
        <StatTile
          label="Changes"
          value={stats.changes}
          tone={stats.changes > 0 ? "primary" : undefined}
          detail="Writes by an operator"
        />
        <StatTile
          label="Tenant views"
          value={stats.views}
          detail="Opening a tenant is recorded"
        />
        <StatTile
          label="Operators"
          value={stats.operators}
          detail="Distinct emails on this page"
        />
      </section>

      <DataTableCard>
        <AuditFilterBar filters={filters} organizationName={organizationName} />

        {data.rows.length === 0 ? (
          <DataTableEmpty
            icon={ScrollText}
            title={
              hasAuditFilters(filters)
                ? "Nothing matches these filters"
                : "Nothing recorded yet"
            }
            description={
              hasAuditFilters(filters)
                ? "Try removing a filter."
                : "Entries appear here as operators open tenants and make changes."
            }
          />
        ) : (
          <AuditTable rows={data.rows} onInspect={setInspected} />
        )}

        <DataTableCursorPagination
          count={data.rows.length}
          itemLabel={data.rows.length === 1 ? "record" : "records"}
          prev={
            isFirstPage
              ? null
              : { href: `/admin/audit${auditQuery(filters)}`, label: "Newest" }
          }
          next={
            data.nextCursor
              ? {
                  href: `/admin/audit${auditQuery(filters, data.nextCursor)}`,
                  label: "Older",
                }
              : null
          }
        />
      </DataTableCard>

      <AuditPayloadDrawer row={inspected} onClose={() => setInspected(null)} />
    </div>
  );
}
