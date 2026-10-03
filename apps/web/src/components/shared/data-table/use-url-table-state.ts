"use client";

import { useQueryParams } from "@/hooks";

import { useDebouncedSearch } from "./use-debounced-search";

/**
 * Filter, search and paging state for a table whose rows come from the
 * server: all of it lives in the URL (shareable, survives reload, works with
 * back/forward) and changing any filter returns to page 1. Search keeps a
 * local draft so typing stays instant, and only the settled value (300 ms)
 * reaches the URL and so triggers a fetch. `pending` is true from the
 * navigation starting until the new rows arrive.
 */
export function useUrlTableState({
  searchParam = "q",
}: { searchParam?: string } = {}) {
  const { getQueryObject, createQueryFromObject, isPending } = useQueryParams();
  const query = getQueryObject();

  const search = useDebouncedSearch(String(query[searchParam] ?? ""), (value) =>
    createQueryFromObject({ [searchParam]: value || undefined, page: 1 }),
  );

  /** Sets one filter, or removes it when it is back at its default (`"all"`). */
  const setFilter = (key: string, value: string, defaultValue = "all") =>
    createQueryFromObject({
      [key]: value === defaultValue ? undefined : value,
      page: 1,
    });

  /** Sets several params at once, leaving paging alone (a sort change keeps the page). */
  const setParams = (patch: Record<string, string | number | undefined>) =>
    createQueryFromObject(patch);

  const setPage = (page: number) => createQueryFromObject({ page });

  const setPageSize = (pageSize: number) =>
    createQueryFromObject({ pageSize, page: 1 });

  /** Clears search and every named filter in one navigation. */
  const reset = (filterKeys: readonly string[]) => {
    search.clear();
    createQueryFromObject({
      [searchParam]: undefined,
      ...Object.fromEntries(filterKeys.map((key) => [key, undefined])),
      page: 1,
    });
  };

  return {
    query,
    search: search.draft,
    setSearch: search.setDraft,
    setFilter,
    setParams,
    setPage,
    setPageSize,
    reset,
    pending: isPending,
  };
}
