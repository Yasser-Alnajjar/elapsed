"use client";

import { RefreshCw } from "lucide-react";
import { healthPresentation } from "@/components/admin/tenant-badges";
import {
  DataTableFilterChips,
  DataTableSearch,
  DataTableSelect,
  DataTableToolbar,
  type FilterOption,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import type {
  TenantHealthFilter,
  TenantListControls,
  TenantPlanFilter,
} from "@/lib/admin-tenant-list";
import { TONE_TEXT } from "@/lib/status-styles";
import {
  PLAN_STATUSES,
  PLAN_STATUS_LABELS,
  TENANT_SORTS,
  TENANT_SORT_LABELS,
  type TenantHealth,
} from "@/lib/types/admin";
import { cn } from "@/lib/utils";

const HEALTH_LABELS: Record<TenantHealthFilter, string> = {
  all: "All",
  unhealthy: "Unhealthy",
  attention: "Needs a look",
  healthy: "Healthy",
  none: "No integrations",
};

const HEALTH_OPTIONS: FilterOption<TenantHealthFilter>[] = (
  Object.keys(HEALTH_LABELS) as TenantHealthFilter[]
).map((value) => {
  const presentation = value === "all" ? null : healthPresentation(value);
  return {
    value,
    label: HEALTH_LABELS[value],
    glyph: presentation?.glyph ?? undefined,
    tone: presentation ? TONE_TEXT[presentation.tone] : undefined,
  };
});

const PLAN_OPTIONS: { value: TenantPlanFilter; label: string }[] = [
  { value: "all", label: "All plans" },
  ...PLAN_STATUSES.map((status) => ({
    value: status,
    label: PLAN_STATUS_LABELS[status],
  })),
  { value: "unrecorded", label: "Not recorded" },
];

const SORT_OPTIONS = TENANT_SORTS.map((sort) => ({
  value: sort,
  label: TENANT_SORT_LABELS[sort],
}));

interface TenantsToolbarProps {
  controls: TenantListControls;
  onChange: (next: Partial<TenantListControls>) => void;
  counts: Record<TenantHealth | "all", number>;
  onRefresh: () => void;
  refreshing: boolean;
  /** Present only while a filter is active. */
  onReset?: () => void;
}

/** Search, plan and sort selects, health filter chips (with counts) and refresh. Controls only; the list is derived in the view. */
export function TenantsToolbar({
  controls,
  onChange,
  counts,
  onRefresh,
  refreshing,
  onReset,
}: TenantsToolbarProps) {
  return (
    <DataTableToolbar
      search={
        <DataTableSearch
          value={controls.query}
          onChange={(query) => onChange({ query })}
          placeholder="Search by name, owner email or tenant id"
          ariaLabel="Search tenants"
        />
      }
      filters={
        <>
          <DataTableSelect
            ariaLabel="Filter by plan"
            value={controls.plan}
            options={PLAN_OPTIONS}
            onValueChange={(plan) => onChange({ plan })}
          />
          <DataTableSelect
            ariaLabel="Sort tenants"
            prefix="Sort by:"
            value={controls.sort}
            options={SORT_OPTIONS}
            onValueChange={(sort) => onChange({ sort })}
          />
        </>
      }
      onReset={onReset}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      }
      chips={
        <DataTableFilterChips
          label="Health"
          options={HEALTH_OPTIONS}
          value={controls.health}
          counts={counts}
          onChange={(health) => onChange({ health })}
        />
      }
    />
  );
}
