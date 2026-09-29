"use client";

import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  GROUP_LABEL,
  LINK_FILTERS,
  OPEN_FILTERS,
  SEVERITY_FILTERS,
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
  return (
    <div className="flex flex-col gap-4 rounded bg-surface-container-low p-4 shadow-sm">
      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-center flex-wrap">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute inset-s-3 top-2.5 size-4.5 text-outline" />

          <Input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Search customer, ticket ID, or subject…"
            aria-label="Search cases"
            className="h-auto bg-surface-container-lowest py-2 ps-10 pe-24 text-sm text-on-surface shadow-inner md:text-sm"
          />

          <div className="pointer-events-none absolute inset-e-2.5 top-2 flex items-center gap-1">
            <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xxs text-on-surface-variant">
              ZD
            </span>

            <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xxs text-on-surface-variant">
              ENG
            </span>
          </div>
        </div>

        <FilterGroup
          label="SEVERITY:"
          options={SEVERITY_FILTERS}
          value={severity}
          counts={severityCounts}
          onChange={setSeverity}
        />

        <FilterGroup
          label="LINK:"
          options={LINK_FILTERS}
          value={linkState}
          counts={linkCounts}
          onChange={setLinkState}
        />

        <FilterGroup
          label="SLA STATUS:"
          options={STATUS_FILTERS}
          value={status}
          counts={statusCounts}
          onChange={setStatus}
        />

        <FilterGroup
          label="OPEN:"
          options={OPEN_FILTERS}
          value={openState}
          counts={openCounts}
          onChange={setOpenState}
        />
      </div>
    </div>
  );
}

type FilterOption<T extends string> = {
  value: T;
  label: string;
  tone?: string;
  dot?: string;
  badge?: string;
};

interface FilterGroupProps<T extends string> {
  label: string;
  options: readonly FilterOption<T>[];
  value: T;
  counts?: Partial<Record<T, number>>;
  onChange: (value: T) => void;
  variant?: "default" | "status";
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
              "gap-1 rounded px-2.5 py-1 font-mono text-xxs font-semibold tracking-wider",
              "transition-colors duration-150",
              filter.tone,
              active
                ? cn("bg-current/10", "hover:bg-current/15")
                : cn("hover:bg-current/10"),
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
