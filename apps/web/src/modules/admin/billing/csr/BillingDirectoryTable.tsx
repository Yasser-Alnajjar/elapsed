"use client";

import { ChevronRight, ReceiptText, SearchX, SlidersHorizontal, TimerReset, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { DataTableEmpty } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BILLING_COLUMN_LABELS, BILLING_COLUMNS, type AdminBillingTenantRow, type BillingColumn } from "@/lib/types/admin-billing";
import { cn } from "@/lib/utils";
import { IngressCell, NextBillingCell, PaymentCell, PlanCell, RateCell, SeatsCell, StateCell, TenantCell } from "./billing-cells";

interface BillingDirectoryTableProps {
  /** The current page. */
  rows: AdminBillingTenantRow[];
  columns: Set<BillingColumn>;
  /** Clears search and filters; absent when nothing is applied. */
  onReset?: () => void;
}

const CELLS: Record<BillingColumn, (props: { row: AdminBillingTenantRow }) => React.ReactNode> = {
  plan: PlanCell,
  state: StateCell,
  seats: SeatsCell,
  rate: RateCell,
  next_billing: NextBillingCell,
  payment: PaymentCell,
  ingress: IngressCell,
};

/** The shortcut that matches the row's state, straight to the override that usually follows it on the tenant's page. */
function quickAction(row: AdminBillingTenantRow): { icon: LucideIcon; label: string; className: string } {
  if (row.overdueDays !== null) return { icon: TimerReset, label: "Review overdue invoice", className: "bg-error/15 text-error hover:bg-error hover:text-error-foreground" };
  if (row.openCents > 0) return { icon: ReceiptText, label: "Record payment", className: "text-warning-text" };
  return { icon: SlidersHorizontal, label: "Edit plan", className: "text-foreground-subtle hover:text-foreground" };
}

/** The tenant billing table: one row per tenant and the optional columns the operator chose. Lives in the card with its toolbar and pager. */
export function BillingDirectoryTable({ rows, columns, onReset }: BillingDirectoryTableProps) {
  const shown = BILLING_COLUMNS.filter((column) => columns.has(column));

  if (rows.length === 0) {
    return (
      <DataTableEmpty
        icon={SearchX}
        title="No tenants match"
        description="Nothing fits the current search and filters."
        action={
          onReset && (
            <Button type="button" variant="outline" size="sm" onClick={onReset}>
              Reset filters
            </Button>
          )
        }
      />
    );
  }

  return (
    <Table className="min-w-[1100px]">
      <TableHeader>
        <TableRow>
          <TableHead>Tenant / identifier</TableHead>
          {shown.map((column) => (
            <TableHead key={column}>{BILLING_COLUMN_LABELS[column]}</TableHead>
          ))}
          <TableHead align="end">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const quick = quickAction(row);
          const QuickIcon = quick.icon;
          return (
            <TableRow
              key={row.id}
              className={cn(
                "group",
                row.status === "past_due" && "bg-error/[0.03]",
                row.status === "internal" && "opacity-85",
                row.status === "cancelled" && "opacity-60",
              )}
            >
              <TableCell>
                <TenantCell row={row} />
              </TableCell>
              {shown.map((column) => {
                const Cell = CELLS[column];
                return (
                  <TableCell key={column}>
                    <Cell row={row} />
                  </TableCell>
                );
              })}
              <TableCell align="end">
                <div className="flex items-center justify-end gap-1">
                  <Button asChild variant="ghost" size="icon-xs" className={quick.className}>
                    <Link href={`/admin/billing/${row.id}#overrides`} title={quick.label} aria-label={`${quick.label}: ${row.name}`}>
                      <QuickIcon className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/billing/${row.id}`}>
                      Inspect
                      <ChevronRight aria-hidden />
                      <span className="sr-only">{row.name}</span>
                    </Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
