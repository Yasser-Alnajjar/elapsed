"use client";

import { Button } from "@/components/ui/button";
import {
  formatPriorityTierName,
  type PriorityTier,
} from "@/lib/format";
import { PRIORITY_TIER_STYLES } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

export type FilterOption<T extends string> = {
  value: T;
  label: string;
  /** Text colour of the option (it also tints the active background via `bg-current`). */
  tone?: string;
  dot?: string;
  /** Count pill colours while the option is inactive. */
  badge?: string;
};

/** Severity (P1–P4) options, shared by every list that filters on ticket priority. */
export const PRIORITY_TIER_FILTER_OPTIONS: FilterOption<"all" | PriorityTier>[] =
  [
    { value: "all", label: "All" },
    ...(["P1", "P2", "P3", "P4"] as const).map((tier) => ({
      value: tier,
      label: `${tier} ${formatPriorityTierName(tier)}`,
      tone: PRIORITY_TIER_STYLES[tier].text,
      dot: PRIORITY_TIER_STYLES[tier].dot,
      badge: PRIORITY_TIER_STYLES[tier].chip,
    })),
  ];

/** A labelled row of single-select filter chips with optional counts. */
export function FilterGroup<T extends string>({
  label,
  options,
  value,
  counts,
  onChange,
}: {
  label: string;
  options: readonly FilterOption<T>[];
  value: T;
  counts?: Partial<Record<T, number>>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-1 self-start rounded bg-surface-container-lowest p-1 lg:shrink-0 lg:self-auto">
      <span className="px-2 font-mono text-xxs font-semibold tracking-wider text-outline sm:inline">
        {label}
      </span>
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
