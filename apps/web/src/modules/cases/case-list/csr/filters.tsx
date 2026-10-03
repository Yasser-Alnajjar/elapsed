"use client";

import type { Table } from "@tanstack/react-table";

import {
  DataTableFilterChips,
  DataTableSearch,
  DataTableToolbar,
  DataTableViewOptions,
  PRIORITY_TIER_FILTER_OPTIONS,
} from "@/components/shared/data-table";
import type { CaseListRow } from "@/lib/types/cases";

import {
  LINK_FILTERS,
  OPEN_FILTERS,
  STATUS_FILTERS,
  type LinkFilter,
  type OpenFilter,
  type SeverityFilter,
  type StatusFilter,
} from "./constants";

interface CaseListToolbarProps {
  table: Table<CaseListRow>;
  search: string;
  onSearchChange: (value: string) => void;
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
  /** Present only while a filter is active. */
  onReset?: () => void;
}

export function CaseListToolbar({
  table,
  search,
  onSearchChange,
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
  onReset,
}: CaseListToolbarProps) {
  return (
    <DataTableToolbar
      search={
        <DataTableSearch
          value={search}
          onChange={onSearchChange}
          placeholder="Search customer, ticket ID, or subject…"
          ariaLabel="Search cases"
        />
      }
      onReset={onReset}
      actions={<DataTableViewOptions table={table} />}
      chips={
        <>
          <DataTableFilterChips
            label="Severity"
            options={PRIORITY_TIER_FILTER_OPTIONS}
            value={severity}
            counts={severityCounts}
            onChange={setSeverity}
          />
          <DataTableFilterChips
            label="Link"
            options={LINK_FILTERS}
            value={linkState}
            counts={linkCounts}
            onChange={setLinkState}
          />
          <DataTableFilterChips
            label="SLA status"
            options={STATUS_FILTERS}
            value={status}
            counts={statusCounts}
            onChange={setStatus}
          />
          <DataTableFilterChips
            label="Open"
            options={OPEN_FILTERS}
            value={openState}
            counts={openCounts}
            onChange={setOpenState}
          />
        </>
      }
    />
  );
}
