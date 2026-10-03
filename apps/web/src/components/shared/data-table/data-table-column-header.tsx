import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
}

/**
 * A column heading. A sortable column is one button that cycles ascending →
 * descending → unsorted, with the arrow always showing the current state; a
 * column that cannot sort is plain text. Alignment comes from the column's
 * `meta.align` (set it to `"end"` for numbers), so a heading sits over its cells.
 */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const end = column.columnDef.meta?.align === "end";

  if (!column.getCanSort()) {
    return <span className={className}>{title}</span>;
  }

  const sorted = column.getIsSorted();
  const Icon =
    sorted === "desc" ? ArrowDown : sorted === "asc" ? ArrowUp : ChevronsUpDown;

  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        "-mx-2 inline-flex items-center gap-1 rounded px-2 py-1 uppercase transition-colors outline-none hover:bg-interactive/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
        end && "flex-row-reverse",
        sorted && "text-foreground",
        className,
      )}
    >
      <span>{title}</span>
      <Icon
        aria-hidden
        className={cn("size-3.5 shrink-0", !sorted && "opacity-40")}
      />
    </button>
  );
}
