"use client";

import { RefreshCw, Search, X } from "lucide-react";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { TONE_TEXT } from "@/lib/status-styles";
import { healthPresentation } from "@/components/admin/tenant-badges";
import { Button } from "@/components/ui/button";
import type {
  TenantHealthFilter,
  TenantListControls,
  TenantPlanFilter,
} from "@/lib/admin-tenant-list";
import {
  PLAN_STATUSES,
  PLAN_STATUS_LABELS,
  TENANT_SORTS,
  TENANT_SORT_LABELS,
  type TenantHealth,
  type TenantSort,
} from "@/lib/types/admin";
import { cn } from "@/lib/utils";

const HEALTH_FILTERS: { value: TenantHealthFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unhealthy", label: "Unhealthy" },
  { value: "attention", label: "Needs a look" },
  { value: "healthy", label: "Healthy" },
  { value: "none", label: "No integrations" },
];

interface TenantsToolbarProps {
  controls: TenantListControls;
  onChange: (next: Partial<TenantListControls>) => void;
  counts: Record<TenantHealth | "all", number>;
  onRefresh: () => void;
  refreshing: boolean;
}

/** Search, health filter chips (with counts), plan and sort selects. Controls only; the list is derived in the view. */
export function TenantsToolbar({
  controls,
  onChange,
  counts,
  onRefresh,
  refreshing,
}: TenantsToolbarProps) {
  return (
    <AdminPanel className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-lg min-w-0 flex-1">
          <Search
            className="text-foreground-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            value={controls.query}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder="Search by name, owner email or tenant id"
            aria-label="Search tenants"
            className="bg-background border-border text-foreground placeholder:text-foreground-subtle focus:border-primary h-9 w-full rounded border pr-8 pl-9 font-mono text-xs outline-none transition-colors"
          />
          {controls.query !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange({ query: "" })}
              className="text-foreground-subtle hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by health"
        >
          {HEALTH_FILTERS.map((filter) => {
            const selected = controls.health === filter.value;
            const presentation =
              filter.value === "all" ? null : healthPresentation(filter.value);
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ health: filter.value })}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1.5 font-mono text-xxs font-semibold tracking-[0.04em] uppercase transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : cn(
                        "bg-surface-raised hover:bg-surface-hover",
                        presentation
                          ? TONE_TEXT[presentation.tone]
                          : "text-foreground",
                      ),
                )}
              >
                {presentation?.glyph && (
                  <span aria-hidden className="text-[10px]">
                    {presentation.glyph}
                  </span>
                )}
                {filter.label}
                <span
                  className={cn(
                    "rounded px-1.5 py-px text-[10px] tabular-nums",
                    selected
                      ? "bg-background/25"
                      : "bg-background/50 text-muted-foreground",
                  )}
                >
                  {counts[filter.value]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-foreground-subtle flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <ToolbarSelect
            label="Plan"
            value={controls.plan}
            onChange={(value) => onChange({ plan: value as TenantPlanFilter })}
            options={[
              { value: "all", label: "All plans" },
              ...PLAN_STATUSES.map((status) => ({
                value: status,
                label: PLAN_STATUS_LABELS[status],
              })),
              { value: "unrecorded", label: "Not recorded" },
            ]}
          />
          <ToolbarSelect
            label="Sort by"
            value={controls.sort}
            onChange={(value) => onChange({ sort: value as TenantSort })}
            options={TENANT_SORTS.map((sort) => ({
              value: sort,
              label: TENANT_SORT_LABELS[sort],
            }))}
          />
        </div>
        <Button
          type="button"
          variant="surface"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          className="h-7 font-mono text-xs"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>
    </AdminPanel>
  );
}

function ToolbarSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2">
      <MonoLabel>{label}</MonoLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-background border-border text-foreground focus:border-primary h-7 rounded border px-2 font-mono text-xs outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
