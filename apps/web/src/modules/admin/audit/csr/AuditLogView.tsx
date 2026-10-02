"use client";

import { ScrollText } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AdminPanel,
  MonoLabel,
  PageHeader,
  StatTile,
} from "@/components/admin/admin-ui";
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

      <AuditFilterBar filters={filters} organizationName={organizationName} />

      <AdminPanel className="overflow-hidden">
        {data.rows.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="text-foreground text-sm font-semibold">
              {hasAuditFilters(filters)
                ? "Nothing matches these filters"
                : "Nothing recorded yet"}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {hasAuditFilters(filters)
                ? "Try removing a filter."
                : "Entries appear here as operators open tenants and make changes."}
            </p>
          </div>
        ) : (
          <AuditTable rows={data.rows} onInspect={setInspected} />
        )}

        <nav
          aria-label="Audit log pages"
          className="bg-surface-raised border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 font-mono text-xxs"
        >
          <span className="text-foreground-subtle">
            Showing{" "}
            <span className="text-foreground font-semibold tabular-nums">
              {data.rows.length}
            </span>{" "}
            record{data.rows.length === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-4">
            {!isFirstPage && (
              <Link
                href={`/admin/audit${auditQuery(filters)}`}
                className="text-primary font-semibold hover:underline"
              >
                Newest
              </Link>
            )}
            {data.nextCursor && (
              <Link
                href={`/admin/audit${auditQuery(filters, data.nextCursor)}`}
                className="text-primary font-semibold hover:underline"
              >
                Older
              </Link>
            )}
          </span>
        </nav>
      </AdminPanel>

      <AuditPayloadDrawer row={inspected} onClose={() => setInspected(null)} />
    </div>
  );
}
