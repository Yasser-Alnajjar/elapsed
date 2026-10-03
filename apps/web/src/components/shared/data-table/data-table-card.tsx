import type { ComponentProps, ReactNode } from "react";

import { pageRange } from "@/lib/pagination";
import { cn } from "@/lib/utils";

/**
 * The one table container: a bordered, rounded card holding the toolbar, the
 * table and the footer, in that order. `overflow-clip` rounds the corners
 * without becoming a scroll box, so a sticky header can still stick to the page.
 */
export function DataTableCard({
  className,
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "flex w-full min-w-0 flex-col overflow-clip rounded-lg border border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}

/** The strip under a table: result count on the left, paging (or nothing) on the right. */
export function DataTableFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-border bg-surface-raised px-4 py-2.5 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    />
  );
}

const figure = "font-semibold text-foreground tabular-nums";

/** "Showing 1–25 of 312 cases"; without a `page`, "Showing 8 of 20 tenants". */
export function DataTableRangeSummary({
  total,
  shown,
  page,
  pageSize,
  label,
}: {
  total: number;
  /** Rows currently displayed, when the list is not paged. */
  shown?: number;
  page?: number;
  pageSize?: number;
  /** Plural noun for the rows: "cases", "tenants". */
  label: string;
}): ReactNode {
  if (page !== undefined && pageSize !== undefined) {
    const { from, to } = pageRange(page, pageSize, total);
    return (
      <span>
        Showing{" "}
        <span className={figure}>{total === 0 ? 0 : `${from}–${to}`}</span> of{" "}
        <span className={figure}>{total}</span> {label}
      </span>
    );
  }
  return (
    <span>
      Showing <span className={figure}>{shown ?? total}</span> of{" "}
      <span className={figure}>{total}</span> {label}
    </span>
  );
}
