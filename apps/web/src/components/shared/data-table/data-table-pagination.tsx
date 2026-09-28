"use client";

import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useQueryParams } from "@hooks";

import { DataTableViewOptions } from "./data-table-view-options";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  className?: string;
  prefix?: string;
  /** Overrides the "Total" figure in manual-pagination mode, where the table only ever holds one page of rows. */
  rowCount?: number;
}

export function DataTablePagination<TData>({
  table,
  className,
  prefix,
  rowCount,
}: DataTablePaginationProps<TData>) {
  const { createQueryFromObject, getQueryObject } = useQueryParams();

  const [goToPage, setGoToPage] = useState<number | undefined>(undefined);

  const query = getQueryObject();

  const params = {
    page: prefix ? `${prefix}Page` : "page",
    pageSize: prefix ? `${prefix}PageSize` : "pageSize",
  };

  const page = Math.max(Number(query[params.page]) || 1, 1);
  const pageSize = Math.max(Number(query[params.pageSize]) || 10, 1);

  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex + 1;

  const setPage = (newPage: number) => {
    const safePage = Math.max(1, Math.min(newPage, pageCount || 1));

    createQueryFromObject({
      [params.page]: safePage,
    });
  };

  const handlePageSizeChange = (value: string) => {
    createQueryFromObject({
      [params.pageSize]: Number(value),
      [params.page]: 1,
    });
  };

  const handleGoToPage = () => {
    if (goToPage === undefined) return;

    setPage(goToPage);
    setGoToPage(undefined);
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-between gap-4 text-sm text-muted-foreground md:flex-row",
        className,
      )}
    >
      {/* Left */}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        <DataTableViewOptions table={table} />

        <div className="order-2 flex items-center gap-2 md:order-1">
          <span>Show</span>

          <Select value={`${pageSize}`} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="h-8 w-17.5">
              <SelectValue />
            </SelectTrigger>

            <SelectContent side="top">
              {[10, 20, 30, 50, 75, 100].map((size) => (
                <SelectItem key={size} value={`${size}`}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span>Per Page</span>
        </div>
      </div>

      {/* Right */}
      <div className="order-1 flex flex-wrap items-center justify-center gap-2 lg:gap-4 md:order-2">
        {/* Pagination Info */}
        <div className="text-nowrap text-sm font-medium">
          Total: {rowCount ?? table.getPrePaginationRowModel().rows.length}{" "}
          <span>|</span> Page {currentPage} of {pageCount}
        </div>

        {/* Go To Page */}
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={pageCount || 1}
            value={goToPage ?? ""}
            placeholder="Go to page"
            className="min-w-30"
            onChange={(event) => {
              const value = event.target.value;

              if (value === "") {
                setGoToPage(undefined);
                return;
              }

              const number = Number(value);

              if (!Number.isNaN(number) && number >= 1) {
                setGoToPage(Math.min(number, pageCount || 1));
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleGoToPage();
              }
            }}
          />

          <Button
            variant="outline"
            onClick={handleGoToPage}
            disabled={goToPage === undefined}
          >
            Go
          </Button>
        </div>

        {/* Previous / Next */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => setPage(page - 1)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>

            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>

          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => setPage(page + 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>

            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
