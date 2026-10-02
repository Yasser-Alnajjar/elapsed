"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { auditQuery, hasAuditFilters } from "@/lib/admin-audit-filters";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_ACTION_LABELS,
  type AdminAuditAction,
  type AdminAuditFilters,
} from "@/lib/types/admin";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface AuditFilterBarProps {
  filters: AdminAuditFilters;
  /** Display name of the organization being filtered to, when there is one. */
  organizationName: string | null;
}

/**
 * Filters live in the URL, so a filtered view can be shared and the pager
 * keeps them. Changing one starts again from the newest page.
 */
export function AuditFilterBar({
  filters,
  organizationName,
}: AuditFilterBarProps) {
  const router = useRouter();
  const [actor, setActor] = useState(filters.actor ?? "");

  function go(next: AdminAuditFilters) {
    router.push(`/admin/audit${auditQuery(next)}`);
  }

  function handleActorSubmit(event: FormEvent) {
    event.preventDefault();
    go({ ...filters, actor: actor.trim() || null });
  }

  return (
    <AdminPanel className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form
          onSubmit={handleActorSubmit}
          role="search"
          className="relative max-w-md min-w-0 flex-1"
        >
          <Search
            className="text-foreground-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            placeholder="Filter by operator email"
            aria-label="Filter by operator email"
            className="bg-background border-border text-foreground placeholder:text-foreground-subtle focus:border-primary h-9 w-full rounded border pr-3 pl-9 font-mono text-xs outline-none transition-colors"
          />
        </form>

        <label className="flex items-center gap-2">
          <MonoLabel>Action</MonoLabel>
          <select
            value={filters.action ?? ""}
            onChange={(event) =>
              go({
                ...filters,
                action: (event.target.value || null) as AdminAuditAction | null,
              })
            }
            className="bg-background border-border text-foreground focus:border-primary h-9 rounded border px-2 font-mono text-xs outline-none"
          >
            <option value="">All actions</option>
            {ADMIN_AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {ADMIN_AUDIT_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>

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
            className="text-muted-foreground cursor-pointer font-mono text-xs"
          >
            Hide tenant views
          </Label>
        </div>
      </div>

      {(filters.organizationId || hasAuditFilters(filters)) && (
        <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
          {filters.organizationId && (
            <span className="bg-primary/10 text-primary flex items-center gap-1.5 rounded border border-primary/30 px-2 py-1 font-mono text-xxs">
              Tenant: {organizationName ?? filters.organizationId}
              <button
                type="button"
                aria-label="Remove tenant filter"
                onClick={() => go({ ...filters, organizationId: null })}
              >
                <X className="size-3" />
              </button>
            </span>
          )}
          <Button
            type="button"
            variant="subtle"
            size="compact"
            className="font-mono text-xs"
            onClick={() => {
              setActor("");
              router.push("/admin/audit");
            }}
          >
            Reset filters
          </Button>
        </div>
      )}
    </AdminPanel>
  );
}
