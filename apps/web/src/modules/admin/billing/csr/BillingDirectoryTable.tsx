"use client";

import { ChevronLeft, ChevronRight, ReceiptText, SearchX, SlidersHorizontal, TimerReset, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { AdminPanel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { pageWindow } from "@/lib/admin-billing-list";
import { formatMoney } from "@/lib/billing-format";
import { BILLING_COLUMN_LABELS, BILLING_COLUMNS, type AdminBillingTenantRow, type BillingColumn } from "@/lib/types/admin-billing";
import { cn } from "@/lib/utils";
import { IngressCell, NextBillingCell, PaymentCell, PlanCell, RateCell, SeatsCell, StateCell, TenantCell } from "./billing-cells";

interface BillingDirectoryTableProps {
  /** The current page. */
  rows: AdminBillingTenantRow[];
  columns: Set<BillingColumn>;
  /** Rows across every page, after filters. */
  total: number;
  firstIndex: number;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  mrrCents: number;
  currency: string;
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

const HEAD = "text-foreground-subtle px-3 py-2.5 text-left font-mono text-[10px] leading-3 font-semibold tracking-[0.08em] uppercase";

/** The shortcut that matches the row's state, straight to the override that usually follows it on the tenant's page. */
function quickAction(row: AdminBillingTenantRow): { icon: LucideIcon; label: string; className: string } {
  if (row.overdueDays !== null) return { icon: TimerReset, label: "Review overdue invoice", className: "bg-error/15 text-error hover:bg-error hover:text-error-foreground" };
  if (row.openCents > 0) return { icon: ReceiptText, label: "Record payment", className: "text-warning-text" };
  return { icon: SlidersHorizontal, label: "Edit plan", className: "text-foreground-subtle hover:text-foreground" };
}

/** The tenant billing table: one row per tenant, the optional columns the operator chose, and the paging footer. */
export function BillingDirectoryTable({ rows, columns, total, firstIndex, page, pageCount, onPage, mrrCents, currency, onReset }: BillingDirectoryTableProps) {
  const shown = BILLING_COLUMNS.filter((column) => columns.has(column));

  return (
    <AdminPanel className="flex flex-col overflow-hidden">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
          <SearchX aria-hidden className="text-foreground-subtle size-6" />
          <div>
            <p className="text-foreground text-sm font-semibold">No tenants match</p>
            <p className="text-muted-foreground mt-0.5 text-sm">Nothing fits the current search and filters.</p>
          </div>
          {onReset && (
            <Button type="button" variant="surface" size="sm" onClick={onReset}>
              Reset filters
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="bg-surface-raised">
              <tr>
                <th scope="col" className={cn(HEAD, "px-4")}>Tenant / identifier</th>
                {shown.map((column) => (
                  <th key={column} scope="col" className={HEAD}>
                    {BILLING_COLUMN_LABELS[column]}
                  </th>
                ))}
                <th scope="col" className={cn(HEAD, "px-4 text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {rows.map((row) => {
                const quick = quickAction(row);
                const QuickIcon = quick.icon;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "group hover:bg-surface-raised transition-colors",
                      row.status === "past_due" && "bg-error/[0.03]",
                      row.status === "internal" && "opacity-85",
                      row.status === "cancelled" && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-2">
                      <TenantCell row={row} />
                    </td>
                    {shown.map((column) => {
                      const Cell = CELLS[column];
                      return (
                        <td key={column} className="px-3 py-2">
                          <Cell row={row} />
                        </td>
                      );
                    })}
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/admin/billing/${row.id}#overrides`}
                          title={quick.label}
                          aria-label={`${quick.label}: ${row.name}`}
                          className={cn("bg-surface-raised hover:bg-surface-hover rounded p-1 transition-colors", quick.className)}
                        >
                          <QuickIcon className="size-4" />
                        </Link>
                        <Link
                          href={`/admin/billing/${row.id}`}
                          className="bg-surface-raised text-foreground hover:bg-primary hover:text-primary-foreground flex items-center gap-0.5 rounded px-2 py-1 font-mono text-[10px] font-semibold transition-colors"
                        >
                          Inspect
                          <ChevronRight aria-hidden className="size-3.5" />
                          <span className="sr-only">{row.name}</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-surface-raised border-border flex flex-col items-center justify-between gap-2 border-t px-4 py-2.5 md:flex-row">
        <div className="text-foreground-subtle flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase">
          <span>
            Showing{" "}
            <span className="text-foreground font-bold tabular-nums">
              {total === 0 ? 0 : firstIndex + 1}–{firstIndex + rows.length}
            </span>{" "}
            of <span className="text-foreground font-bold tabular-nums">{total}</span> tenants
          </span>
          <span className="text-muted-foreground normal-case">
            Active MRR:{" "}
            <span className="text-primary font-bold tabular-nums">
              {formatMoney(mrrCents, currency)} {currency}
            </span>
          </span>
        </div>
        <nav aria-label="Pagination" className="flex items-center gap-1 font-mono text-[10px]">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
            className="bg-card text-muted-foreground hover:text-foreground flex items-center gap-1 rounded px-2.5 py-1 transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            PREV
          </button>
          {pageWindow(page, pageCount).map((p, index) =>
            p === null ? (
              <span key={`gap-${index}`} aria-hidden className="text-foreground-subtle px-1">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-current={p === page ? "page" : undefined}
                aria-label={`Page ${p + 1}`}
                onClick={() => onPage(p)}
                className={cn(
                  "flex size-6 items-center justify-center rounded transition-colors",
                  p === page ? "bg-primary text-primary-foreground font-bold" : "bg-card text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {p + 1}
              </button>
            ),
          )}
          <button
            type="button"
            disabled={page + 1 >= pageCount}
            onClick={() => onPage(page + 1)}
            className="bg-card text-muted-foreground hover:text-foreground flex items-center gap-1 rounded px-2.5 py-1 transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            NEXT
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
        </nav>
      </div>
    </AdminPanel>
  );
}
