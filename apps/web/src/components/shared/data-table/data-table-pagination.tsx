"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAGE_SIZE_OPTIONS, pageWindow } from "@/lib/pagination";
import { cn } from "@/lib/utils";

import { DataTableFooter, DataTableRangeSummary } from "./data-table-card";

/** Past this many pages the numbered window cannot reach every page, so a "go to page" box appears. */
const GO_TO_PAGE_THRESHOLD = 10;

const NAV_BUTTON = "h-8 gap-1 px-2.5 text-xs [&_svg]:size-3.5";

export interface DataTablePaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  pageCount: number;
  /** Rows across every page, after filters. */
  rowCount: number;
  onPageChange: (page: number) => void;
  /** Omit when the page size is not the user's to change. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  /** Plural noun for the rows, in the summary: "cases", "invoices". */
  itemLabel: string;
  /** Extra footer information, beside the range: a total, a snapshot time. */
  summary?: ReactNode;
  /** A page change is in flight; the controls wait for it. */
  pending?: boolean;
  className?: string;
}

/**
 * The one pager: result range on the left; rows-per-page, numbered pages and
 * previous/next on the right. It knows nothing about where the rows come
 * from — a server-paginated list wires the callbacks to the URL, an in-memory
 * one to `useClientPagination` — so every table pages the same way.
 */
export function DataTablePagination({
  page,
  pageSize,
  pageCount,
  rowCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  itemLabel,
  summary,
  pending = false,
  className,
}: DataTablePaginationProps) {
  const [goTo, setGoTo] = useState("");
  const empty = rowCount === 0;
  const sizes = [...new Set([...pageSizeOptions, pageSize])].sort((a, b) => a - b);

  const setPage = (next: number) =>
    onPageChange(Math.max(1, Math.min(next, pageCount)));

  const submitGoTo = () => {
    const target = Number(goTo);
    if (Number.isInteger(target) && target >= 1) setPage(target);
    setGoTo("");
  };

  return (
    <DataTableFooter className={className}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <DataTableRangeSummary
          total={rowCount}
          page={page}
          pageSize={pageSize}
          label={itemLabel}
        />
        {summary}
      </div>

      {!empty && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {onPageSizeChange && (
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap">Rows per page</span>
              <Select
                value={`${pageSize}`}
                onValueChange={(value) => onPageSizeChange(Number(value))}
                disabled={pending}
              >
                <SelectTrigger
                  aria-label="Rows per page"
                  className="w-18 data-[size=default]:h-8"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="top">
                  {sizes.map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <nav aria-label="Pagination" className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="bare"
              className={NAV_BUTTON}
              disabled={pending || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft aria-hidden className="rtl:rotate-180" />
              <span className="sr-only sm:not-sr-only">Previous</span>
            </Button>

            <span className="px-2 whitespace-nowrap tabular-nums sm:hidden">
              Page {page} of {pageCount}
            </span>
            <div className="hidden items-center gap-1 sm:flex">
              {pageWindow(page, pageCount).map((entry, index) =>
                entry === null ? (
                  <span key={`gap-${index}`} aria-hidden className="px-1">
                    …
                  </span>
                ) : (
                  <Button
                    key={entry}
                    type="button"
                    variant={entry === page ? "default" : "outline"}
                    size="bare"
                    aria-label={`Page ${entry}`}
                    aria-current={entry === page ? "page" : undefined}
                    disabled={pending}
                    className="h-8 min-w-8 px-2 text-xs tabular-nums"
                    onClick={() => setPage(entry)}
                  >
                    {entry}
                  </Button>
                ),
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="bare"
              className={NAV_BUTTON}
              disabled={pending || page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              <span className="sr-only sm:not-sr-only">Next</span>
              <ChevronRight aria-hidden className="rtl:rotate-180" />
            </Button>
          </nav>

          {pageCount > GO_TO_PAGE_THRESHOLD && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={pageCount}
                value={goTo}
                placeholder="Go to page"
                aria-label="Go to page"
                className="h-8 w-28"
                onChange={(event) => setGoTo(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitGoTo();
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="bare"
                className={NAV_BUTTON}
                disabled={pending || goTo === ""}
                onClick={submitGoTo}
              >
                Go
              </Button>
            </div>
          )}
        </div>
      )}
    </DataTableFooter>
  );
}

interface CursorLink {
  href: string;
  label: string;
}

/**
 * The same footer for a list that pages by cursor (it cannot know a page
 * number or a total): the count of rows on screen, then previous/next links
 * styled exactly like the numbered pager's buttons.
 */
export function DataTableCursorPagination({
  count,
  itemLabel,
  prev,
  next,
  summary,
  className,
}: {
  count: number;
  itemLabel: string;
  prev: CursorLink | null;
  next: CursorLink | null;
  summary?: ReactNode;
  className?: string;
}) {
  return (
    <DataTableFooter className={className}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          Showing{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {count}
          </span>{" "}
          {itemLabel}
        </span>
        {summary}
      </div>
      <nav aria-label="Pagination" className="flex items-center gap-1">
        <CursorButton link={prev} direction="prev" />
        <CursorButton link={next} direction="next" />
      </nav>
    </DataTableFooter>
  );
}

function CursorButton({
  link,
  direction,
}: {
  link: CursorLink | null;
  direction: "prev" | "next";
}) {
  const prev = direction === "prev";
  const Icon = prev ? ChevronLeft : ChevronRight;
  const label = link?.label ?? (prev ? "Newest" : "Older");
  const content = (
    <>
      {prev && <Icon aria-hidden className="rtl:rotate-180" />}
      <span>{label}</span>
      {!prev && <Icon aria-hidden className="rtl:rotate-180" />}
    </>
  );
  return (
    <Button
      variant="outline"
      size="bare"
      className={cn(NAV_BUTTON)}
      disabled={!link}
      asChild={Boolean(link)}
    >
      {link ? <Link href={link.href}>{content}</Link> : content}
    </Button>
  );
}
