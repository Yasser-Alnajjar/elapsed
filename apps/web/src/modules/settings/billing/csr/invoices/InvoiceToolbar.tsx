"use client";

import { FileDown, FileText } from "lucide-react";
import {
  DataTableFilterChips,
  DataTableSearch,
  DataTableSelect,
  DataTableToolbar,
  type FilterOption,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { INVOICE_STATUS_FILTERS, type InvoiceControls, type InvoiceStatusFilter } from "@/lib/billing-invoices";

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
  /** Present only while the status or search filter is active. */
  onReset?: () => void;
}

const STATUS_FILTER_LABELS: Record<InvoiceStatusFilter, string> = {
  all: "All invoices",
  paid: "Paid only",
  open: "Open",
  failed: "Failed",
  refunded: "Refunded",
  void: "Void",
};

/** Search, status select, the fiscal-year chips, and the two exports. */
export function InvoiceToolbar({ controls, onChange, years, currentYear, counts, onExport, exportDisabled, onTaxSummary, taxSummaryAvailable, onReset }: InvoiceToolbarProps) {
  const yearOptions: FilterOption<string>[] = years.slice(0, 3).map((year) => ({
    value: String(year),
    label: year === currentYear ? `${year} (Active)` : String(year),
  }));

  return (
    <DataTableToolbar
      search={
        <DataTableSearch
          value={controls.query}
          onChange={(query) => onChange({ query })}
          placeholder="Search by invoice ID or ref…"
          ariaLabel="Search invoices"
        />
      }
      filters={
        <DataTableSelect
          ariaLabel="Filter by status"
          prefix="Status:"
          value={controls.status}
          options={INVOICE_STATUS_FILTERS.map((status) => ({
            value: status,
            label: `${STATUS_FILTER_LABELS[status]} (${counts[status]})`,
          }))}
          onValueChange={(status) => onChange({ status })}
        />
      }
      onReset={onReset}
      actions={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={exportDisabled}>
            <FileDown aria-hidden />
            Export all CSV
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onTaxSummary}
            disabled={!taxSummaryAvailable}
            title={taxSummaryAvailable ? undefined : "Available once a payment provider is connected."}
          >
            <FileText aria-hidden />
            Annual tax summary (PDF)
          </Button>
        </>
      }
      chips={
        <DataTableFilterChips
          label="Fiscal year"
          options={yearOptions}
          value={String(controls.year)}
          onChange={(year) => onChange({ year: Number(year) })}
        />
      }
    />
  );
}
