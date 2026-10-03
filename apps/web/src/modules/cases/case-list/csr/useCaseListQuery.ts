"use client";

import type { SortingState } from "@tanstack/react-table";

import { useUrlTableState } from "@/components/shared/data-table";
import type { CaseListSortId } from "@/lib/types/cases";

import type {
  LinkFilter,
  OpenFilter,
  SeverityFilter,
  StatusFilter,
} from "./constants";

const FILTER_KEYS = ["status", "openState", "linkState", "severity"] as const;

/**
 * The case list's filters, search, sort and paging, all held in the URL
 * query (`useUrlTableState`): any filter change returns to page 1, search is
 * debounced behind a local draft, and `exportCsv` opens the CSV export for
 * the same filters.
 */
export function useCaseListQuery() {
  const url = useUrlTableState();
  const { query } = url;

  const globalFilter = String(query.q ?? "");
  const status = (query.status as StatusFilter) ?? "all";
  const openState = (query.openState as OpenFilter) ?? "all";
  const linkState = (query.linkState as LinkFilter) ?? "all";
  const severity = (query.severity as SeverityFilter) ?? "all";

  const sorting: SortingState = query.sort
    ? [{ id: String(query.sort), desc: query.dir !== "asc" }]
    : [];

  const handleSortingChange = (next: SortingState) => {
    const first = next[0];
    url.setParams({
      sort: first ? (first.id as CaseListSortId) : undefined,
      dir: first ? (first.desc ? "desc" : "asc") : undefined,
    });
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (openState !== "all") params.set("openState", openState);
    if (linkState !== "all") params.set("linkState", linkState);
    if (severity !== "all") params.set("severity", severity);
    if (globalFilter) params.set("q", globalFilter);
    window.open(`/api/cases/export?${params.toString()}`, "_blank");
  };

  const hasActiveFilters =
    Boolean(globalFilter) ||
    status !== "all" ||
    openState !== "all" ||
    linkState !== "all" ||
    severity !== "all";

  return {
    filters: { globalFilter, status, openState, linkState, severity },
    searchDraft: url.search,
    setGlobalFilter: url.setSearch,
    setStatus: (value: StatusFilter) => url.setFilter("status", value),
    setOpenState: (value: OpenFilter) => url.setFilter("openState", value),
    setLinkState: (value: LinkFilter) => url.setFilter("linkState", value),
    setSeverity: (value: SeverityFilter) => url.setFilter("severity", value),
    hasActiveFilters,
    resetFilters: () => url.reset(FILTER_KEYS),
    sorting,
    handleSortingChange,
    handleExport,
    setPage: url.setPage,
    setPageSize: url.setPageSize,
    pending: url.pending,
  };
}
