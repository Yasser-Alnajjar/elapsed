"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { useDebouncedSearch } from "./use-debounced-search";

type ParamPatch = Record<string, string | number | undefined>;

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const query: Record<string, string | undefined> = Object.fromEntries(searchParams);

  /** Applies `patch` to the current query; an `undefined` or empty value removes that param. */
  const navigate = (patch: ParamPatch) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") params.delete(key);
      else params.set(key, String(value));
    }
    startTransition(() => router.push(`?${params}`, { scroll: false }));
  };

  const search = useDebouncedSearch(query[searchParam] ?? "", (value) =>
    navigate({ [searchParam]: value, page: 1 }),
  );

  /** Sets one filter, or removes it when it is back at its default (`"all"`). */
  const setFilter = (key: string, value: string, defaultValue = "all") =>
    navigate({ [key]: value === defaultValue ? undefined : value, page: 1 });

  const setPage = (page: number) => navigate({ page });

  const setPageSize = (pageSize: number) => navigate({ pageSize, page: 1 });

  /** Clears search and every named filter in one navigation. */
  const reset = (filterKeys: readonly string[]) => {
    search.clear();
    navigate({
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
    /** Sets several params at once, leaving paging alone (a sort change keeps the page). */
    setParams: navigate,
    setPage,
    setPageSize,
    reset,
    pending,
  };
}
