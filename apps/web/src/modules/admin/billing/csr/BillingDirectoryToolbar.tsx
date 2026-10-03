"use client";

import { ChevronsUpDown, Columns3, FileDown, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BillingListControls, BillingStatusFilter } from "@/lib/admin-billing-list";
import { TONE_TEXT } from "@/lib/status-styles";
import {
  BILLING_COLUMN_LABELS,
  BILLING_COLUMNS,
  BILLING_HEALTH_LABELS,
  BILLING_HEALTHS,
  BILLING_PLAN_TIER_LABELS,
  BILLING_PLAN_TIERS,
  BILLING_SORT_LABELS,
  BILLING_SORTS,
  type BillingColumn,
  type BillingHealth,
  type BillingPlanTier,
  type BillingSort,
} from "@/lib/types/admin-billing";
import { cn } from "@/lib/utils";

interface BillingDirectoryToolbarProps {
  controls: BillingListControls;
  onChange: (next: Partial<BillingListControls>) => void;
  counts: {
    tier: Record<"all" | BillingPlanTier, number>;
    status: Record<BillingStatusFilter, number>;
    health: Record<BillingHealth, number>;
  };
  columns: Set<BillingColumn>;
  onColumnsChange: (columns: Set<BillingColumn>) => void;
  onExport: () => void;
  exportDisabled: boolean;
}

const STATUS_FILTERS: { value: BillingStatusFilter; label: string; glyph: string | null; tone: "neutral" | "success" | "warning" | "danger" }[] = [
  { value: "all", label: "All", glyph: null, tone: "neutral" },
  { value: "active", label: "Active", glyph: "●", tone: "success" },
  { value: "trialing", label: "Trial", glyph: "▲", tone: "warning" },
  { value: "past_due", label: "Past due", glyph: "✕", tone: "danger" },
];

const HEALTH_TONES: Record<BillingHealth, "neutral" | "warning" | "danger"> = {
  healthy: "neutral",
  expiring: "warning",
  overdue: "danger",
};

const PILL = "rounded px-2.5 py-1 font-mono text-[10px] leading-3 font-semibold tracking-[0.04em] transition-colors whitespace-nowrap";

function FilterPill({ selected, onClick, className, children }: { selected: boolean; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(PILL, selected ? "bg-primary/15 text-primary ring-primary/30 ring-1" : cn("bg-surface-raised hover:bg-surface-hover", className ?? "text-muted-foreground hover:text-foreground"))}
    >
      {children}
    </button>
  );
}

/** Search (⌘K), sort, export and column picker, then the plan, status and health filter pills with their counts. */
export function BillingDirectoryToolbar({ controls, onChange, counts, columns, onColumnsChange, onExport, exportDisabled }: BillingDirectoryToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const toggleColumn = (column: BillingColumn, visible: boolean) => {
    const next = new Set(columns);
    if (visible) next.add(column);
    else next.delete(column);
    onColumnsChange(next);
  };

  return (
    <AdminPanel className="flex flex-col gap-4 p-4">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div className="relative max-w-2xl min-w-0 flex-1">
          <Search aria-hidden className="text-foreground-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            ref={searchRef}
            type="search"
            value={controls.query}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder="Search by tenant name, organization ID, or owner email…"
            aria-label="Search tenants"
            aria-keyshortcuts="Meta+K Control+K"
            className="bg-background border-border text-foreground placeholder:text-foreground-subtle focus:border-primary h-9 w-full rounded border pr-16 pl-9 text-xs outline-none transition-colors"
          />
          {controls.query !== "" ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange({ query: "" })}
              className="text-foreground-subtle hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="bg-surface-raised text-foreground-subtle pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] sm:block">
              ⌘K
            </kbd>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <select
              aria-label="Sort tenants"
              value={controls.sort}
              onChange={(event) => onChange({ sort: event.target.value as BillingSort })}
              className="bg-surface-raised border-border text-foreground focus-visible:ring-primary h-9 cursor-pointer appearance-none rounded border py-2 pr-8 pl-3 font-mono text-[11px] outline-none focus-visible:ring-1"
            >
              {BILLING_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  Sort by: {BILLING_SORT_LABELS[sort]}
                </option>
              ))}
            </select>
            <ChevronsUpDown aria-hidden className="text-foreground-subtle pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />
          </div>
          <Button type="button" variant="surface" size="sm" onClick={onExport} disabled={exportDisabled} className="font-mono text-[11px]">
            <FileDown aria-hidden />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="surface" size="sm" className="font-mono text-[11px]">
                <Columns3 aria-hidden />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {BILLING_COLUMNS.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={columns.has(column)}
                  onCheckedChange={(checked) => toggleColumn(column, checked === true)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {BILLING_COLUMN_LABELS[column]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-3 xl:flex-row xl:items-center">
        <div role="group" aria-label="Filter by plan" className="flex flex-wrap items-center gap-1.5">
          <MonoLabel className="mr-1">Plan:</MonoLabel>
          <FilterPill selected={controls.plan === "all"} onClick={() => onChange({ plan: "all" })}>
            All plans ({counts.tier.all})
          </FilterPill>
          {BILLING_PLAN_TIERS.map((tier) => (
            <FilterPill key={tier} selected={controls.plan === tier} onClick={() => onChange({ plan: tier })}>
              {BILLING_PLAN_TIER_LABELS[tier]} ({counts.tier[tier]})
            </FilterPill>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1.5">
            <MonoLabel className="mr-1">Status:</MonoLabel>
            {STATUS_FILTERS.map((filter) => (
              <FilterPill
                key={filter.value}
                selected={controls.status === filter.value}
                onClick={() => onChange({ status: filter.value })}
                className={filter.value === "all" ? undefined : TONE_TEXT[filter.tone]}
              >
                {filter.glyph && <span aria-hidden>{filter.glyph} </span>}
                {filter.label}
                {filter.value !== "all" && ` (${counts.status[filter.value]})`}
              </FilterPill>
            ))}
          </div>
          <div role="group" aria-label="Filter by payment health" className="flex flex-wrap items-center gap-1.5">
            <MonoLabel className="mr-1">Health:</MonoLabel>
            {BILLING_HEALTHS.map((health) => (
              <FilterPill
                key={health}
                selected={controls.health === health}
                onClick={() => onChange({ health: controls.health === health ? "all" : health })}
                className={HEALTH_TONES[health] === "neutral" ? undefined : TONE_TEXT[HEALTH_TONES[health]]}
              >
                {BILLING_HEALTH_LABELS[health]} ({counts.health[health]})
              </FilterPill>
            ))}
          </div>
        </div>
      </div>
    </AdminPanel>
  );
}
