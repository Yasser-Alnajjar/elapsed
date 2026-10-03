"use client";

import { useRouter } from "next/navigation";
import {
  DataTableActiveFilter,
  DataTableSearch,
  DataTableSelect,
  DataTableToolbar,
  useDebouncedSearch,
} from "@/components/shared/data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { auditQuery, hasAuditFilters } from "@/lib/admin-audit-filters";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_ACTION_LABELS,
  type AdminAuditAction,
  type AdminAuditFilters,
} from "@/lib/types/admin";

interface AuditFilterBarProps {
  filters: AdminAuditFilters;
  /** Display name of the organization being filtered to, when there is one. */
  organizationName: string | null;
}

const ACTION_OPTIONS = [
  { value: "all", label: "All actions" },
  ...ADMIN_AUDIT_ACTIONS.map((action) => ({
    value: action,
    label: ADMIN_AUDIT_ACTION_LABELS[action],
  })),
];

/**
 * Filters live in the URL, so a filtered view can be shared and the pager
 * keeps them. Changing one starts again from the newest page.
 */
export function AuditFilterBar({
  filters,
  organizationName,
}: AuditFilterBarProps) {
  const router = useRouter();

  function go(next: AdminAuditFilters) {
    router.push(`/admin/audit${auditQuery(next)}`);
  }

  const actor = useDebouncedSearch(filters.actor ?? "", (value) =>
    go({ ...filters, actor: value.trim() || null }),
  );

  return (
    <DataTableToolbar
      search={
        <DataTableSearch
          value={actor.draft}
          onChange={actor.setDraft}
          placeholder="Filter by operator email"
          ariaLabel="Filter by operator email"
        />
      }
      filters={
        <>
          <DataTableSelect
            ariaLabel="Filter by action"
            value={filters.action ?? "all"}
            options={ACTION_OPTIONS}
            onValueChange={(value) =>
              go({
                ...filters,
                action: value === "all" ? null : (value as AdminAuditAction),
              })
            }
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="hide-tenant-views"
              checked={Boolean(filters.hideViews) && !filters.action}
              disabled={Boolean(filters.action)}
              onCheckedChange={(checked) =>
                go({ ...filters, hideViews: checked === true })
              }
            />
            <Label
              htmlFor="hide-tenant-views"
              className="cursor-pointer text-xs text-muted-foreground"
            >
              Hide tenant views
            </Label>
          </div>
        </>
      }
      onReset={
        hasAuditFilters(filters)
          ? () => {
              actor.clear();
              router.push("/admin/audit");
            }
          : undefined
      }
      activeFilters={
        filters.organizationId && (
          <DataTableActiveFilter
            label={<>Tenant: {organizationName ?? filters.organizationId}</>}
            removeLabel="Remove tenant filter"
            onRemove={() => go({ ...filters, organizationId: null })}
          />
        )
      }
    />
  );
}
