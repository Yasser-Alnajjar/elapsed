"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  type ColumnDef,
  type RowData,
  type SortingState,
  type Table as TTable,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { DataTableCard } from "./data-table-card";
import {
  DataTablePagination,
  type DataTablePaginationProps,
} from "./data-table-pagination";
import { DataTableEmptyRow } from "./data-table-states";

type Align = "start" | "center" | "end";

/** Per-column presentation, read from `columnDef.meta`. */
export interface DataTableColumnMeta {
  /** Name shown in the column picker. */
  name?: string;
  /** Header and cell alignment; numbers and the actions column use `"end"`. */
  align?: Align;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  /** The rows to show: for a paged table, the current page only. */
  data: TData[];
  /** Rendered above the table inside the card. Receives the TanStack table, for the column picker. */
  toolbar?: (context: { table: TTable<TData> }) => React.ReactNode;
  /** Props for the footer pager. Omit for a table with no paging. */
  pagination?: Omit<DataTablePaginationProps, "className">;
  /**
   * Controlled sorting. Pass both when sorting happens server-side: the table
   * then shows `sorting` and reports clicks through `onSortingChange` instead
   * of reordering `data` itself.
   */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** A refetch is in flight: the rows dim and the table is marked busy. */
  loading?: boolean;
  /** Shown in place of the rows when `data` is empty. */
  empty?: React.ReactNode;
  /** Let the user drag column headers to reorder them. */
  reorderable?: boolean;
  /** Let the user drag a column's right edge to resize it. */
  resizable?: boolean;
  rowSelection?: Record<string, boolean>;
  onRowSelectionChange?: (selection: Record<string, boolean>) => void;
  className?: string;
  rowClassName?: string;
}

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue>
    extends DataTableColumnMeta {}
}

const alignOf = (meta: DataTableColumnMeta | undefined): Align | undefined =>
  meta?.align;

/**
 * The column-driven table (TanStack): sortable headers, column visibility,
 * row selection, and the standard card, toolbar and pager around them. Use it
 * when a table is a list of uniform rows described by column definitions. A
 * table of bespoke composite rows composes the same pieces by hand —
 * `DataTableCard`, `DataTableToolbar`, the `Table` primitives and
 * `DataTablePagination` — and looks identical.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  toolbar,
  pagination,
  sorting: controlledSorting,
  onSortingChange: onControlledSortingChange,
  loading = false,
  empty,
  reorderable = false,
  resizable = false,
  rowSelection,
  onRowSelectionChange,
  className,
  rowClassName,
}: DataTableProps<TData, TValue>) {
  const serverSorted = onControlledSortingChange !== undefined;
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const sorting = serverSorted ? (controlledSorting ?? []) : localSorting;
  const [columnOrder, setColumnOrder] = useState<string[]>(
    columns.map((col) => col.id || (col as { accessorKey?: string }).accessorKey || ""),
  );
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(() =>
    columns.map(() => 100),
  );

  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const previousPositions = useRef<Map<string, DOMRect>>(new Map());

  const captureRowPositions = () => {
    previousPositions.current.clear();
    rowRefs.current.forEach((element, id) => {
      if (element) {
        previousPositions.current.set(id, element.getBoundingClientRect());
      }
    });
  };

  const table = useReactTable({
    data,
    columns,
    onSortingChange: (updater) => {
      captureRowPositions();
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (serverSorted) onControlledSortingChange?.(next);
      else setLocalSorting(next);
    },
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: serverSorted ? undefined : getSortedRowModel(),
    onRowSelectionChange: onRowSelectionChange
      ? (updaterOrValue) => {
          const value =
            typeof updaterOrValue === "function"
              ? updaterOrValue(rowSelection ?? {})
              : updaterOrValue;
          onRowSelectionChange(value);
        }
      : undefined,
    manualSorting: serverSorted,
    state: {
      sorting,
      columnOrder,
      ...(rowSelection ? { rowSelection } : {}),
    },
  });

  const rows = table.getRowModel().rows;

  // Sorting reorders rows; slide them from where they were to where they land.
  useEffect(() => {
    if (previousPositions.current.size === 0) return;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rowRefs.current.forEach((element, id) => {
          const previousRect = previousPositions.current.get(id);
          if (!element || !previousRect) return;
          const deltaY = previousRect.top - element.getBoundingClientRect().top;
          if (Math.abs(deltaY) > 1) {
            element.animate(
              [
                { transform: `translateY(${deltaY}px)` },
                { transform: "translateY(0)" },
              ],
              { duration: 300, easing: "cubic-bezier(0.2, 0, 0.2, 1)" },
            );
          }
        });
        previousPositions.current.clear();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [rows]);

  const handleDrop = (event: React.DragEvent, targetColumnId: string) => {
    event.preventDefault();
    if (draggedColumn && draggedColumn !== targetColumnId) {
      const order = [...table.getState().columnOrder];
      order.splice(order.indexOf(draggedColumn), 1);
      order.splice(order.indexOf(targetColumnId), 0, draggedColumn);
      setColumnOrder(order);
    }
    setDraggedColumn(null);
  };

  const startResize = (index: number, event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = colWidths[index] || 100;

    const onMove = (move: MouseEvent) =>
      setColWidths((prev) => {
        const next = [...prev];
        next[index] = Math.max(50, startWidth + move.clientX - startX);
        return next;
      });
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <DataTableCard className={className}>
      {toolbar?.({ table })}

      <Table busy={loading} className={resizable ? "table-auto" : undefined}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header, index) => (
                <TableHead
                  key={header.id}
                  align={alignOf(header.column.columnDef.meta)}
                  aria-sort={
                    header.column.getIsSorted() === "asc"
                      ? "ascending"
                      : header.column.getIsSorted() === "desc"
                        ? "descending"
                        : undefined
                  }
                  className={cn(
                    (resizable || reorderable) && "relative select-none",
                    reorderable && "cursor-move",
                  )}
                  draggable={reorderable}
                  onDragStart={
                    reorderable
                      ? (event) => {
                          setDraggedColumn(header.id);
                          event.dataTransfer.effectAllowed = "move";
                        }
                      : undefined
                  }
                  onDragOver={
                    reorderable
                      ? (event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      : undefined
                  }
                  onDrop={
                    reorderable
                      ? (event) => handleDrop(event, header.id)
                      : undefined
                  }
                  style={resizable ? { width: colWidths[index] } : undefined}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                  {resizable && (
                    <div
                      className="absolute inset-e-0 top-0 h-full w-1 cursor-col-resize hover:bg-border-strong"
                      onMouseDown={(event) => startResize(index, event)}
                    />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow
                key={row.id}
                ref={(element) => {
                  if (element) rowRefs.current.set(row.id, element);
                  else rowRefs.current.delete(row.id);
                }}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={rowClassName}
              >
                {row.getVisibleCells().map((cell, index) => (
                  <TableCell
                    key={cell.id}
                    align={alignOf(cell.column.columnDef.meta)}
                    style={{
                      width: resizable ? colWidths[index] : undefined,
                      minWidth: cell.column.columnDef.minSize,
                      maxWidth: cell.column.columnDef.maxSize,
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <DataTableEmptyRow colSpan={table.getVisibleLeafColumns().length}>
              {empty}
            </DataTableEmptyRow>
          )}
        </TableBody>
      </Table>

      {pagination && (
        <DataTablePagination {...pagination} pending={pagination.pending || loading} />
      )}
    </DataTableCard>
  );
}
