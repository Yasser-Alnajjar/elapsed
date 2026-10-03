"use client";

import { ChevronDown, FileDown, FileText, Search, X } from "lucide-react";
import { BillingCard } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import { INVOICE_STATUS_FILTERS, type InvoiceControls, type InvoiceStatusFilter } from "@/lib/billing-invoices";
import { cn } from "@/lib/utils";

interface InvoiceToolbarProps {
  controls: InvoiceControls;
  onChange: (next: Partial<InvoiceControls>) => void;
  years: number[];
  currentYear: number;
  counts: Record<InvoiceStatusFilter, number>;
  onExport: () => void;
  exportDisabled: boolean;
  onTaxSummary: () => void;
  /** Tax summaries are produced by the payment provider. */
  taxSummaryAvailable: boolean;
}

const STATUS_FILTER_LABELS: Record<InvoiceStatusFilter, string> = {
  all: "All invoices",
  paid: "Paid only",
  open: "Open",
  failed: "Failed",
  refunded: "Refunded",
  void: "Void",
};

const FIELD = "bg-surface-raised text-foreground border-border focus-visible:ring-primary rounded-lg border font-mono text-xs outline-none focus-visible:ring-1";

/** Year switcher, status select, invoice search, and the two exports. */
export function InvoiceToolbar({ controls, onChange, years, currentYear, counts, onExport, exportDisabled, onTaxSummary, taxSummaryAvailable }: InvoiceToolbarProps) {
  return (
    <BillingCard className="flex flex-col justify-between gap-4 p-4 lg:flex-row lg:items-center">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Fiscal year" className="bg-surface-raised border-border flex items-center rounded-lg border p-1">
          {years.slice(0, 3).map((year) => {
            const selected = year === controls.year;
            return (
              <button
                key={year}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ year })}
                className={cn(
                  "rounded px-3 py-1 font-mono text-[11px] transition-colors",
                  selected ? "bg-primary text-primary-foreground font-semibold shadow-sm" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {year}
                {year === currentYear && " (Active)"}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <select
            aria-label="Filter by status"
            value={controls.status}
            onChange={(event) => onChange({ status: event.target.value as InvoiceStatusFilter })}
            className={cn(FIELD, "h-9 cursor-pointer appearance-none py-2 pr-8 pl-3")}
          >
            {INVOICE_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                Status: {STATUS_FILTER_LABELS[status]} ({counts[status]})
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="text-foreground-subtle pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />
        </div>

        <div className="relative flex items-center">
          <Search aria-hidden className="text-foreground-subtle pointer-events-none absolute left-2.5 size-4" />
          <input
            type="search"
            value={controls.query}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder="Search by invoice ID or ref…"
            aria-label="Search invoices"
            className={cn(FIELD, "placeholder:text-foreground-subtle h-9 w-52 py-2 pr-8 pl-8 transition-[width] focus:w-64")}
          />
          {controls.query !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange({ query: "" })}
              className="text-foreground-subtle hover:text-foreground absolute right-2.5"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="surface" size="sm" onClick={onExport} disabled={exportDisabled} className="group font-mono">
          <FileDown aria-hidden className="text-muted-foreground group-hover:text-primary" />
          Export all CSV
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onTaxSummary}
          disabled={!taxSummaryAvailable}
          title={taxSummaryAvailable ? undefined : "Available once a payment provider is connected."}
          className="font-mono font-semibold"
        >
          <FileText aria-hidden />
          Annual tax summary (PDF)
        </Button>
      </div>
    </BillingCard>
  );
}
