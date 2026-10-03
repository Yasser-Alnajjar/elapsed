"use client";

import {
  DataTableFilterChips,
  DataTableSearch,
  DataTableToolbar,
  PRIORITY_TIER_FILTER_OPTIONS,
} from "@/components/shared/data-table";

import { AT_RISK_LEG_FILTERS } from "./constants";
import type { LegFilter, SeverityFilter } from "./types";

type AtRiskToolbarProps = {
  severity: SeverityFilter;
  leg: LegFilter;
  query: string;
  severityCounts: Record<SeverityFilter, number>;
  legCounts: Record<LegFilter, number>;
  onSeverityChange: (value: SeverityFilter) => void;
  onLegChange: (value: LegFilter) => void;
  onQueryChange: (value: string) => void;
  /** Present only while a filter is active. */
  onReset?: () => void;
};

export const AtRiskToolbar = ({
  severity,
  leg,
  query,
  severityCounts,
  legCounts,
  onSeverityChange,
  onLegChange,
  onQueryChange,
  onReset,
}: AtRiskToolbarProps) => (
  <DataTableToolbar
    search={
      <DataTableSearch
        value={query}
        onChange={onQueryChange}
        placeholder="Search customer, ticket ID, or subject…"
        ariaLabel="Search at-risk cases"
      />
    }
    onReset={onReset}
    chips={
      <>
        <DataTableFilterChips
          label="Severity"
          options={PRIORITY_TIER_FILTER_OPTIONS}
          value={severity}
          counts={severityCounts}
          onChange={onSeverityChange}
        />
        <DataTableFilterChips
          label="Locus"
          options={AT_RISK_LEG_FILTERS}
          value={leg}
          counts={legCounts}
          onChange={onLegChange}
        />
      </>
    }
  />
);
