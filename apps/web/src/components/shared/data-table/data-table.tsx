"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  type ColumnDef,
  PaginationState,
  type SortingState,
  type Table as TTable,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { DataTablePagination } from "./data-table-pagination";
import { complexFilter } from "./complexFilter";
import { useQueryParams } from "@hooks";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  header?: ({ table }: { table: TTable<TData> }) => React.ReactNode;
  title?: string;
  EditForm?: React.ComponentType<
    { rowData: TData; onClose: () => void } & Record<string, any>
  >;
  rowSelection?: Record<string, boolean>;
  onRowSelectionChange?: (selection: Record<string, boolean>) => void;
  editFormProps?: Record<string, any>;
  dialogClassName?: string;
  className?: string;
  headerClassName?: string;
  /** Applied to the scroll wrapper; defaults to forcing `text-xs` on every descendant. Pass `""` to let cells own their type scale. */
  textClassName?: string;
  /** Extra classes for every `<th>` / `<td>`. */
  headCellClassName?: string;
  cellClassName?: string;
  rowClassName?: string;
  globalFilter?: string;
  setGlobalFilter?: (value: string) => void;
  onDoubleClick?: (row: TData) => void;
  paginated?: boolean;
  prefix?: string;
  empty?: React.ReactNode;
  /**
   * Opt-in server-driven mode: `data` is only the current page, sorting and
   * filtering happen server-side, and the caller (not this component) owns
   * `sorting` state. No other consumer of `DataTable` uses this — added for
   * the case list's server-paginated rewrite (performance-plan.md Phase 2
   * item 1).
   */
  manual?: boolean;
  /** Manual mode only: total page count, from the server's row count. */
  pageCount?: number;
  /** Manual mode only: total matching row count, for the pagination footer. */
  rowCount?: number;
  /** Manual mode only: controlled sorting state. */
  sorting?: SortingState;
  /** Manual mode only: called when the user clicks a sortable column header. */
  onSortingChange?: (sorting: SortingState) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  header,
  headerClassName,
  textClassName = "**:text-xs",
  headCellClassName,
  cellClassName,
  rowClassName,
  globalFilter,
  setGlobalFilter,
  rowSelection,
  onRowSelectionChange,
  onDoubleClick,
  paginated = true,
  className,
  prefix,
  empty,
  manual = false,
  pageCount,
  rowCount,
  sorting: controlledSorting,
  onSortingChange: onSortingChangeExternal,
}: DataTableProps<TData, TValue>) {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const sorting = manual ? (controlledSorting ?? []) : localSorting;
  const [columnOrder, setColumnOrder] = useState<string[]>(
    columns.map((col) => col.id || (col as any).accessorKey),
  );
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const { getQueryObject, createQueryFromObject } = useQueryParams();

  const query = getQueryObject();

  const paginationParams = {
    page: prefix ? `${prefix}Page` : "page",
    pageSize: prefix ? `${prefix}PageSize` : "pageSize",
  };

  const pageIndex = Math.max(0, Number(query[paginationParams.page] ?? 1) - 1);

  const pageSize = Math.max(1, Number(query[paginationParams.pageSize] ?? 10));

  const pagination: PaginationState = {
    pageIndex,
    pageSize,
  };
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const previousPositions = useRef<Map<string, DOMRect>>(new Map());
  const processedColumns = columns.map((column) => {
    if (column.enableColumnFilter && !column.filterFn) {
      return { ...column, filterFn: complexFilter };
    }
    return column;
  });

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
    columns: processedColumns,
    onSortingChange: (updater) => {
      captureRowPositions();
      const next =
        typeof updater === "function" ? updater(sorting) : updater;
      if (manual) onSortingChangeExternal?.(next);
      else setLocalSorting(next);
    },
    onGlobalFilterChange: setGlobalFilter,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel:
      paginated && !manual ? getPaginationRowModel() : undefined,
    getSortedRowModel: manual ? undefined : getSortedRowModel(),
    getFilteredRowModel: manual ? undefined : getFilteredRowModel(),
    onRowSelectionChange: onRowSelectionChange
      ? (updaterOrValue) => {
          // updaterOrValue can be a value or an updater function
          const value =
            typeof updaterOrValue === "function"
              ? updaterOrValue(rowSelection ?? {})
              : updaterOrValue;
          onRowSelectionChange(value);
        }
      : undefined,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;
      createQueryFromObject({
        page: next.pageIndex + 1,
        pageSize: next.pageSize,
      });
    },
    manualPagination: manual,
    manualSorting: manual,
    pageCount: manual ? pageCount : undefined,
    autoResetPageIndex: false,
    globalFilterFn: "includesString",
    enableColumnFilters: true,
    state: { rowSelection, sorting, globalFilter, columnOrder, pagination },
  });

  const animateRows = () => {
    if (previousPositions.current.size === 0) return;

    const animations: Animation[] = [];

    rowRefs.current.forEach((element, id) => {
      if (!element) return;

      const previousRect = previousPositions.current.get(id);
      if (!previousRect) return;

      const currentRect = element.getBoundingClientRect();
      const deltaY = previousRect.top - currentRect.top;

      if (Math.abs(deltaY) > 1) {
        element.style.transform = `translateY(${deltaY}px)`;
        element.style.transition = "none";
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        element.offsetHeight;
        element.style.transition =
          "transform 0.3s cubic-bezier(0.2, 0, 0.2, 1)";
        element.style.transform = "translateY(0)";

        const animation = element.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: "translateY(0)" },
          ],
          {
            duration: 300,
            easing: "cubic-bezier(0.2, 0, 0.2, 1)",
            fill: "both",
          },
        );

        animations.push(animation);
      }
    });

    Promise.all(animations.map((anim) => anim.finished)).then(() => {
      rowRefs.current.forEach((element) => {
        if (element) {
          element.style.transform = "";
          element.style.transition = "";
        }
      });
    });
  };

  useEffect(() => {
    if (previousPositions.current.size > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(animateRows);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getRowModel().rows]);

  const handleRowDoubleClick = (row: TData) => {
    if (onDoubleClick) onDoubleClick(row);
  };

  const handleDragStart = (e: React.DragEvent, columnId: string) => {
    setDraggedColumn(columnId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnId) {
      setDraggedColumn(null);
      return;
    }

    const currentOrder = table.getState().columnOrder;
    const draggedIndex = currentOrder.indexOf(draggedColumn);
    const targetIndex = currentOrder.indexOf(targetColumnId);

    const newOrder = [...currentOrder];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedColumn);

    setColumnOrder(newOrder);
    setDraggedColumn(null);
  };

  const initialWidths = columns.map(() => 100);
  const [colWidths, setColWidths] = useState<number[]>(initialWidths);
  const resizersRef = useRef<(HTMLDivElement | null)[]>([]);

  const handleMouseDown = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[index] || 100;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setColWidths((prev) => {
        const newWidths = [...prev];
        newWidths[index] = Math.max(50, startWidth + deltaX);
        return newWidths;
      });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className={cn("w-full  p-4 lg:p-6", className)}>
      {header && (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between mb-4">
          {header({ table })}
        </div>
      )}

      <div className={cn("overflow-x-auto", textClassName)}>
        <Table className="table-auto w-full">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className={cn(headerClassName)}>
                {headerGroup.headers.map((header, index) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "relative cursor-move select-none whitespace-nowrap",
                      headCellClassName,
                    )}
                    draggable
                    onDragStart={(e) => handleDragStart(e, header.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, header.id)}
                    style={{
                      width: header.id === "actions" ? "1%" : colWidths[index],
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}

                    <div
                      ref={(el) => {
                        resizersRef.current[index] = el;
                      }}
                      className="absolute top-0 inset-e-0 h-full w-1 cursor-col-resize hover:bg-border-strong"
                      onMouseDown={(e) => handleMouseDown(index, e)}
                    />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn("hover:bg-muted/30", rowClassName)}
                >
                  {row.getVisibleCells().map((cell, index) => (
                    <TableCell
                      key={cell.id}
                      className={cellClassName}
                      style={{
                        width:
                          cell.column.id === "actions"
                            ? "1%"
                            : colWidths[index],
                        minWidth: cell.column.columnDef.minSize,
                        maxWidth: cell.column.columnDef.maxSize,
                        whiteSpace:
                          cell.column.id === "actions" ? "nowrap" : undefined,
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {paginated && (
        <div className="flex flex-col sm:flex-row items-center justify-between border-t p-4 gap-4">
          <DataTablePagination table={table} prefix={prefix} rowCount={rowCount} />
        </div>
      )}
    </div>
  );
}
