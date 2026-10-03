"use client";

import { FileDown } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  DataTableColumnPicker,
  DataTableFilterChips,
  DataTableSearch,
  DataTableSelect,
  DataTableToolbar,
  type FilterOption,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
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
} from "@/lib/types/admin-billing";

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
  /** Present only while a filter is active. */
  onReset?: () => void;
}

const SORT_OPTIONS = BILLING_SORTS.map((sort) => ({ value: sort, label: BILLING_SORT_LABELS[sort] }));

const PLAN_OPTIONS: FilterOption<"all" | BillingPlanTier>[] = [
  { value: "all", label: "All plans" },
  ...BILLING_PLAN_TIERS.map((tier) => ({ value: tier, label: BILLING_PLAN_TIER_LABELS[tier] })),
];

const STATUS_OPTIONS: FilterOption<BillingStatusFilter>[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active", glyph: "●", tone: TONE_TEXT.success },
  { value: "trialing", label: "Trial", glyph: "▲", tone: TONE_TEXT.warning },
  { value: "past_due", label: "Past due", glyph: "✕", tone: TONE_TEXT.danger },
];

const HEALTH_OPTIONS: FilterOption<BillingHealth | "all">[] = BILLING_HEALTHS.map((health) => ({
  value: health,
  label: BILLING_HEALTH_LABELS[health],
  tone: health === "expiring" ? TONE_TEXT.warning : health === "overdue" ? TONE_TEXT.danger : undefined,
}));

/** Search (⌘K), sort, export and column picker, then the plan, status and health chip filters with their counts. */
export function BillingDirectoryToolbar({ controls, onChange, counts, columns, onColumnsChange, onExport, exportDisabled, onReset }: BillingDirectoryToolbarProps) {
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
    <DataTableToolbar
      search={
        <DataTableSearch
          inputRef={searchRef}
          value={controls.query}
          onChange={(query) => onChange({ query })}
          placeholder="Search by tenant name, organization ID, or owner email…"
          ariaLabel="Search tenants"
          hint="⌘K"
        />
      }
      filters={
        <DataTableSelect
          ariaLabel="Sort tenants"
          prefix="Sort by:"
          value={controls.sort}
          options={SORT_OPTIONS}
          onValueChange={(sort) => onChange({ sort })}
        />
      }
      onReset={onReset}
      actions={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={exportDisabled}>
            <FileDown aria-hidden />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
          <DataTableColumnPicker
            columns={BILLING_COLUMNS.map((column) => ({
              id: column,
              label: BILLING_COLUMN_LABELS[column],
              visible: columns.has(column),
              onVisibleChange: (visible) => toggleColumn(column, visible),
            }))}
          />
        </>
      }
      chips={
        <>
          <DataTableFilterChips label="Plan" options={PLAN_OPTIONS} value={controls.plan} counts={counts.tier} onChange={(plan) => onChange({ plan })} />
          <DataTableFilterChips label="Status" options={STATUS_OPTIONS} value={controls.status} counts={counts.status} onChange={(status) => onChange({ status })} />
          <DataTableFilterChips
            label="Health"
            options={HEALTH_OPTIONS}
            value={controls.health}
            counts={counts.health}
            onChange={(health) => onChange({ health: controls.health === health ? "all" : health })}
          />
        </>
      }
    />
  );
}
