"use client";

import { Search, X } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { FilterOption } from "./filter-options";

/**
 * The strip above every table, one structure for all of them:
 *
 *   [ Search ] [ Select… ] [ Reset ]                    [ Actions… ]
 *   [ Chip group ] [ Chip group ]
 *   [ Active filter ✕ ]
 *
 * Every slot is optional; a table passes only the controls it needs. The
 * controls below share one height, type scale and focus treatment, so they
 * look the same wherever they appear. Pass `onReset` only while a filter is
 * active: that is what shows the "Reset filters" button.
 */
export function DataTableToolbar({
  search,
  filters,
  actions,
  chips,
  activeFilters,
  onReset,
  className,
}: {
  search?: ReactNode;
  /** Dropdown filters and sorts (`DataTableSelect`). */
  filters?: ReactNode;
  /** Right-aligned: export, refresh, column picker. */
  actions?: ReactNode;
  /** Single-select chip groups (`DataTableFilterChips`), for filters worth seeing at a glance, with counts. */
  chips?: ReactNode;
  /** Removable chips for filters that arrive from elsewhere (`DataTableActiveFilter`). */
  activeFilters?: ReactNode;
  onReset?: () => void;
  className?: string;
}) {
  const hasPrimaryRow = search || filters || actions || onReset;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border p-3 sm:p-4",
        className,
      )}
    >
      {hasPrimaryRow && (
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
          {search}
          {filters && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {filters}
            </div>
          )}
          {onReset && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="self-start text-muted-foreground"
            >
              <X aria-hidden />
              Reset filters
            </Button>
          )}
          {actions && (
            <div className="flex flex-wrap items-center gap-2 lg:ms-auto">
              {actions}
            </div>
          )}
        </div>
      )}
      {chips && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2">
          {chips}
        </div>
      )}
      {activeFilters && (
        <div className="flex flex-wrap items-center gap-2">{activeFilters}</div>
      )}
    </div>
  );
}

/** The search box. Controlled; debounce in the caller when the value drives a server fetch (see `useUrlTableState`). */
export function DataTableSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
  hint,
  inputRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** A short shortcut hint (`⌘K`) shown while the box is empty. */
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  return (
    <div
      className={cn("relative w-full min-w-52 lg:max-w-md lg:flex-1", className)}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
      />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-keyshortcuts={hint ? "Meta+K Control+K" : undefined}
        className="ps-9 pe-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== "" ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute inset-e-2.5 top-1/2 -translate-y-1/2 text-foreground-subtle transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        hint && (
          <kbd className="pointer-events-none absolute inset-e-2.5 top-1/2 hidden -translate-y-1/2 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-foreground-subtle sm:block">
            {hint}
          </kbd>
        )
      )}
    </div>
  );
}

/** A dropdown filter or sort. The first option is the "all" state; picking it clears the filter. */
export function DataTableSelect<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  prefix,
  className,
  disabled,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
  /** Muted text before the selected value: `Sort by:`. */
  prefix?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "w-full data-[size=default]:h-8 sm:w-auto sm:min-w-36",
          className,
        )}
      >
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const CHIP_LABEL =
  "font-mono text-[10px] leading-3 font-semibold tracking-[0.08em] text-foreground-subtle uppercase";

/** A labelled row of single-select filter chips with optional counts. Picking the "all" option clears the filter. */
export function DataTableFilterChips<T extends string>({
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
    <div
      role="group"
      aria-label={label}
      className="flex max-w-full flex-wrap items-center gap-1.5"
    >
      <span className={cn(CHIP_LABEL, "me-1")}>{label}</span>
      {options.map((option) => {
        const active = value === option.value;
        const count = counts?.[option.value];
        return (
          <Button
            key={option.value}
            type="button"
            variant="bare"
            size="chip"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 gap-1.5 whitespace-nowrap ring-1 transition-colors",
              active
                ? option.tone
                  ? "bg-current/10 ring-current/30"
                  : "bg-primary/10 text-primary ring-primary/30"
                : cn(
                    "ring-transparent hover:bg-interactive/60",
                    !option.tone && "text-muted-foreground hover:text-foreground",
                  ),
              option.tone,
            )}
          >
            {option.dot && (
              <span aria-hidden className={cn("size-1.5 rounded-full", option.dot)} />
            )}
            {option.glyph && (
              <span aria-hidden className="text-[10px]">
                {option.glyph}
              </span>
            )}
            <span>{option.label}</span>
            {count !== undefined && (
              <span
                className={cn(
                  "rounded px-1 text-[10px] tabular-nums",
                  active ? "bg-current/15" : (option.badge ?? "bg-surface-raised"),
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

/** A filter that is applied from outside the toolbar (a tenant id in the URL), removable on its own. */
export function DataTableActiveFilter({
  label,
  onRemove,
  removeLabel,
}: {
  label: ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
      {label}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="transition-opacity hover:opacity-70"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
