"use client";

import React from "react";
import type { SortingState } from "@tanstack/react-table";

import { useQueryParams } from "@hooks";
import type { CaseListSortId } from "@/lib/types/cases";

import type {
  LinkFilter,
  OpenFilter,
  SeverityFilter,
  StatusFilter,
} from "./constants";

/** Every case-list filter/sort/search resets pagination to page 1. */
function withPageReset(patch: Record<string, string | number | undefined>) {
  return { ...patch, page: 1 };
}

/**
 * The case list's filters, search, and sort, all held in the URL query.
 * Search is debounced (300ms) behind a local draft so typing stays
 * responsive; `exportCsv` opens the CSV export for the same filters.
 */
export function useCaseListQuery() {
  const { getQueryObject, createQueryFromObject } = useQueryParams();
  const query = getQueryObject();

  const globalFilter = String(query.q ?? "");
  const status = (query.status as StatusFilter) ?? "all";
  const openState = (query.openState as OpenFilter) ?? "all";
  const linkState = (query.linkState as LinkFilter) ?? "all";
  const severity = (query.severity as SeverityFilter) ?? "all";

  const sorting: SortingState = query.sort
    ? [{ id: String(query.sort), desc: query.dir !== "asc" }]
    : [];

  const searchTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [searchDraft, setSearchDraft] = React.useState(globalFilter);
  React.useEffect(() => setSearchDraft(globalFilter), [globalFilter]);

  const setGlobalFilter = (value: string) => {
    setSearchDraft(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      createQueryFromObject(withPageReset({ q: value || undefined }));
    }, 300);
  };

  const setStatus = (value: StatusFilter) =>
    createQueryFromObject(
      withPageReset({ status: value === "all" ? undefined : value }),
    );
  const setOpenState = (value: OpenFilter) =>
    createQueryFromObject(
      withPageReset({ openState: value === "all" ? undefined : value }),
    );
  const setLinkState = (value: LinkFilter) =>
    createQueryFromObject(
      withPageReset({ linkState: value === "all" ? undefined : value }),
    );
  const setSeverity = (value: SeverityFilter) =>
    createQueryFromObject(
      withPageReset({ severity: value === "all" ? undefined : value }),
    );

  const handleSortingChange = (next: SortingState) => {
    const first = next[0];
    createQueryFromObject({
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
    searchDraft,
    setGlobalFilter,
    setStatus,
    setOpenState,
    setLinkState,
    setSeverity,
    hasActiveFilters,
    sorting,
    handleSortingChange,
    handleExport,
  };
}
