import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one table style. Every table in the app — admin consoles, settings,
 * the case list, docs — is built from these primitives, so header height,
 * cell padding, type scale, row hover and alignment never drift apart.
 *
 * Conventions (callers should not restyle these):
 * - Headers are 40px tall, tiny uppercase mono captions on the raised surface.
 * - Cells are `px-4 py-3`, vertically centred; rows holding multi-line cells
 *   pass `align-top` on the row's cells.
 * - Numbers, money and counts are right-aligned (`align="end"`), the actions
 *   column too; text and dates are start-aligned.
 * - Content wraps by default. Identifiers and timestamps use `nowrap`; a cell
 *   that must stay on one line (an email) uses `truncate` and a `title`.
 * - A table scrolls sideways inside its container when it is wider than the
 *   screen (`Table` provides the scroller); set a `min-w-*` on it for wide tables.
 */

type Align = "start" | "center" | "end";

const ALIGN: Record<Align, string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
};

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Wrap in a horizontal scroller (default). Pass `false` when the container already scrolls, or the header must stick to the page. */
  scroll?: boolean;
  /** Dims the rows while a refetch is in flight. */
  busy?: boolean;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, scroll = true, busy, ...props }, ref) => {
    const table = (
      <table
        ref={ref}
        aria-busy={busy || undefined}
        className={cn(
          "w-full caption-bottom border-collapse text-sm transition-opacity",
          busy && "opacity-60",
          className,
        )}
        {...props}
      />
    );
    return scroll ? <div className="w-full overflow-x-auto">{table}</div> : table;
  },
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "bg-surface-raised [&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent",
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-border bg-surface-raised font-medium [&_tr]:border-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border/60 transition-colors hover:bg-surface-raised/60 data-[state=selected]:bg-interactive",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

interface TableHeadProps
  extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: Align;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, align = "start", scope = "col", ...props }, ref) => (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        "h-10 px-4 align-middle font-mono text-[10px] leading-3 font-semibold tracking-[0.08em] whitespace-nowrap text-foreground-subtle uppercase",
        ALIGN[align],
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

interface TableCellProps
  extends Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: Align;
  /** Keep the content on one line (ids, timestamps, amounts). */
  nowrap?: boolean;
  /** Clip long text with an ellipsis instead of wrapping; give the content a `title`. */
  truncate?: boolean;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, align = "start", nowrap, truncate, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-4 py-3 align-middle",
        ALIGN[align],
        nowrap && "whitespace-nowrap",
        truncate && "max-w-64 truncate",
        className,
      )}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};
