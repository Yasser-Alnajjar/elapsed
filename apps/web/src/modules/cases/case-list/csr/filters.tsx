"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  FilterGroup,
  PRIORITY_TIER_FILTER_OPTIONS,
} from "@/components/shared/filter-group";
import { Input } from "@/components/ui/input";
import { Utils } from "@/lib/utils";

import {
  LINK_FILTERS,
  OPEN_FILTERS,
  STATUS_FILTERS,
  type LinkFilter,
  type OpenFilter,
  type SeverityFilter,
  type StatusFilter,
} from "./constants";
interface CaseListFiltersProps {
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  status: StatusFilter;
  setStatus: (value: StatusFilter) => void;
  openState: OpenFilter;
  setOpenState: (value: OpenFilter) => void;
  linkState: LinkFilter;
  setLinkState: (value: LinkFilter) => void;
  severity: SeverityFilter;
  setSeverity: (value: SeverityFilter) => void;
  statusCounts: Record<StatusFilter, number>;
  openCounts: Record<OpenFilter, number>;
  linkCounts: Record<LinkFilter, number>;
  severityCounts: Record<SeverityFilter, number>;
}
export function CaseListFilters({
  globalFilter,
  setGlobalFilter,
  status,
  setStatus,
  openState,
  setOpenState,
  linkState,
  setLinkState,
  severity,
  setSeverity,
  statusCounts,
  openCounts,
  linkCounts,
  severityCounts,
}: CaseListFiltersProps) {
  const [search, setSearch] = useState(globalFilter);
  const debouncedSetGlobalFilter = useMemo(
    () => Utils.debounce(setGlobalFilter, 300),
    [setGlobalFilter],
  );
  const handleSearchChange = (value: string) => {
    setSearch(value);
    debouncedSetGlobalFilter(value);
  };
  return (
    <div className="flex flex-col gap-4 rounded bg-surface-container-low p-4 shadow-sm">
      {" "}
      <div className="flex flex-wrap flex-col items-stretch gap-2 lg:flex-row lg:items-center">
        {" "}
        <div className="relative min-w-60 flex-1">
          {" "}
          <Search className="absolute inset-s-3 top-2.5 size-4.5 text-outline" />{" "}
          <Input
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search customer, ticket ID, or subject…"
            aria-label="Search cases"
            className="h-auto bg-surface-container-lowest py-2 ps-10 pe-24 text-sm text-on-surface shadow-inner md:text-sm"
          />{" "}
          <div className="pointer-events-none absolute inset-e-2.5 top-2 flex items-center gap-1">
            {" "}
            <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xxs text-on-surface-variant">
              {" "}
              ZD{" "}
            </span>{" "}
            <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xxs text-on-surface-variant">
              {" "}
              ENG{" "}
            </span>{" "}
          </div>{" "}
        </div>{" "}
        <FilterGroup
          label="SEVERITY:"
          options={PRIORITY_TIER_FILTER_OPTIONS}
          value={severity}
          counts={severityCounts}
          onChange={setSeverity}
        />{" "}
        <FilterGroup
          label="LINK:"
          options={LINK_FILTERS}
          value={linkState}
          counts={linkCounts}
          onChange={setLinkState}
        />{" "}
        <FilterGroup
          label="SLA STATUS:"
          options={STATUS_FILTERS}
          value={status}
          counts={statusCounts}
          onChange={setStatus}
        />{" "}
        <FilterGroup
          label="OPEN:"
          options={OPEN_FILTERS}
          value={openState}
          counts={openCounts}
          onChange={setOpenState}
        />{" "}
      </div>{" "}
    </div>
  );
}
