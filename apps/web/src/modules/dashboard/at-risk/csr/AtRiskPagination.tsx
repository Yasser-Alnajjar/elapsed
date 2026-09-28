"use client";

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
import { useQueryParams } from "@hooks";

/** Mirrors `DataTablePagination` (cases list) — same layout and controls, adapted from a `@tanstack/react-table` `Table` to this page's server-paginated `AtRiskPageData`. */
type AtRiskPaginationProps = {
  page: number;
  pageSize: number;
  pageCount: number;
  rowCount: number;
};

export function AtRiskPagination({
  page,
  pageSize,
  pageCount,
  rowCount,
}: AtRiskPaginationProps) {
  const { createQueryFromObject } = useQueryParams();
  const [goToPage, setGoToPage] = useState<number | undefined>(undefined);

  const setPage = (newPage: number) => {
    const safePage = Math.max(1, Math.min(newPage, pageCount || 1));
    createQueryFromObject({ page: safePage });
  };

  const handlePageSizeChange = (value: string) => {
    createQueryFromObject({ pageSize: Number(value), page: 1 });
  };

  const handleGoToPage = () => {
    if (goToPage === undefined) return;
    setPage(goToPage);
    setGoToPage(undefined);
  };

  return (
    <div className="flex w-full flex-col items-center justify-between gap-4 rounded bg-surface-container-lowest p-3 text-sm text-muted-foreground md:flex-row">
      {/* Left */}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        <div className="flex items-center gap-2">
          <span>Show</span>

          <Select value={`${pageSize}`} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="h-8 w-17.5">
              <SelectValue />
            </SelectTrigger>

            <SelectContent side="top">
              {[10, 25, 50, 100].map((size) => (
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
      <div className="flex flex-wrap items-center justify-center gap-2 lg:gap-4">
        <div className="text-nowrap text-sm font-medium">
          Total: {rowCount} <span>|</span> Page {page} of {pageCount}
        </div>

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

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>

          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => setPage(page + 1)}
            disabled={page >= pageCount}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
