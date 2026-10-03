"use client";

import { useState } from "react";

import { DEFAULT_PAGE_SIZE, pageCountOf, pageOf } from "@/lib/pagination";

/**
 * Paging state for a list that is already fully in memory (the server sent
 * every row and the client filters it). Spread `props` into
 * `DataTablePagination`; call `resetPage` whenever a filter changes so the
 * user is not left on a page that no longer exists.
 */
export function useClientPagination<T>(
  rows: readonly T[],
  initialPageSize: number = DEFAULT_PAGE_SIZE,
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const pageCount = pageCountOf(rows.length, pageSize);
  const currentPage = Math.min(page, pageCount);

  return {
    pageRows: pageOf(rows, currentPage, pageSize),
    resetPage: () => setPage(1),
    props: {
      page: currentPage,
      pageSize,
      pageCount,
      rowCount: rows.length,
      onPageChange: setPage,
      onPageSizeChange: (size: number) => {
        setPageSizeState(size);
        setPage(1);
      },
    },
  };
}
