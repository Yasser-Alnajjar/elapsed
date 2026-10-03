"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  FilterGroup,
  PRIORITY_TIER_FILTER_OPTIONS,
} from "@/components/shared/filter-group";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Utils } from "@/lib/utils";
import { useQueryParams } from "@/hooks";

import { AT_RISK_LEG_FILTERS } from "./constants";
import type { LegFilter, SeverityFilter } from "./types";

type AtRiskFiltersProps = {
  severity: SeverityFilter;
  leg: LegFilter;
  query: string;
  severityCounts: Record<SeverityFilter, number>;
  legCounts: Record<LegFilter, number>;
  onSeverityChange: (value: SeverityFilter) => void;
  onLegChange: (value: LegFilter) => void;
  onQueryChange: (value: string) => void;
  pageSize: number;
};

export const AtRiskFilters = ({
  severity,
  leg,
  query,
  severityCounts,
  legCounts,
  pageSize,
  onSeverityChange,
  onLegChange,
  onQueryChange,
}: AtRiskFiltersProps) => {
  const { createQueryFromObject } = useQueryParams();

  const [search, setSearch] = useState(query);

  const debouncedQueryChange = useMemo(
    () => Utils.debounce(onQueryChange, 300),
    [onQueryChange],
  );

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debouncedQueryChange(value);
  };

  const handlePageSizeChange = (value: string) => {
    createQueryFromObject({
      pageSize: Number(value),
      page: 1,
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded bg-surface-container-low p-4 shadow-sm">
      <div className="flex flex-col flex-wrap items-stretch gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute inset-s-3 top-2.5 size-4.5 text-outline" />

          <Input
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search customer, ticket ID, or subject…"
            aria-label="Search at-risk cases"
            className="h-auto bg-surface-container-lowest py-2 ps-10 pe-24 text-sm text-on-surface shadow-inner md:text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1.5 self-start rounded bg-surface-container-lowest p-1 sm:justify-start">
          <div className="flex items-center gap-2 text-xs">
            <span>Show</span>

            <Select value={`${pageSize}`} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="h-auto w-17.5">
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

        <FilterGroup
          label="SEVERITY:"
          options={PRIORITY_TIER_FILTER_OPTIONS}
          value={severity}
          counts={severityCounts}
          onChange={onSeverityChange}
        />

        <FilterGroup
          label="LOCUS:"
          options={AT_RISK_LEG_FILTERS}
          value={leg}
          counts={legCounts}
          onChange={onLegChange}
        />
      </div>
    </div>
  );
};
