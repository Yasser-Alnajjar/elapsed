"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, Utils } from "@/lib/utils";
import { useQueryParams } from "@/hooks";

import {
  AT_RISK_LEG_FILTERS,
  AT_RISK_SEVERITY_FILTERS,
  GROUP_LABEL,
} from "./constants";
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
          options={AT_RISK_SEVERITY_FILTERS}
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

type FilterOption<T extends string> = {
  value: T;
  label: string;
  tone: string;
  dot: string;
  badge: string;
};

interface FilterGroupProps<T extends string> {
  label: string;
  options: readonly FilterOption<T>[];
  value: T;
  counts?: Partial<Record<T, number>>;
  onChange: (value: T) => void;
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  counts,
  onChange,
}: FilterGroupProps<T>) {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-1 self-start rounded bg-surface-container-lowest p-1 lg:shrink-0 lg:self-auto">
      <span className={GROUP_LABEL}>{label}</span>

      {options.map((filter) => {
        const active = value === filter.value;
        const count = counts?.[filter.value];

        return (
          <Button
            key={filter.value}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={active}
            onClick={() => onChange(filter.value)}
            className={cn(
              "h-auto gap-1 rounded px-2.5 py-1 font-mono text-xxs font-semibold tracking-wider",
              "transition-colors duration-150",
              filter.tone,
              active
                ? "bg-current/10 hover:bg-current/15"
                : "hover:bg-current/10",
            )}
          >
            {filter.dot && (
              <span className={cn("size-1.5 rounded-full", filter.dot)} />
            )}

            <span>{filter.label}</span>

            {count !== undefined && (
              <span
                className={cn(
                  "rounded px-1 font-mono text-xxs",
                  active ? "bg-current/15" : filter.badge,
                )}
              >
                {count}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
