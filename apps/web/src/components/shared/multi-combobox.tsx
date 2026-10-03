"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  useComboboxAnchor,
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxClear,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from "@/components/ui/combobox";

interface ComboboxOption {
  label: string;
  value: string;
}

interface MultiComboboxProps {
  options: ComboboxOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allSelectedText?: string;
  className?: string;
  disabled?: boolean;
}

const MAX_VISIBLE = 200;

export function MultiCombobox({
  options,
  selected,
  onChange,
  placeholder = "Select items...",
  searchPlaceholder = "Search...",
  emptyText = "No items found.",
  allSelectedText = "All items selected.",
  className,
  disabled = false,
}: MultiComboboxProps) {
  const anchor = useComboboxAnchor();
  const [inputValue, setInputValue] = useState("");

  // A Set keeps both passes below O(n) instead of O(n*m) once `options`
  // reaches catalog size and re-filters on every keystroke.
  const selectedSet = new Set(selected);
  const selectedOptions = options.filter((o) => selectedSet.has(o.value));

  // Selected values are excluded from the list; the chips are the only
  // representation of a selection, and the only way to remove one.
  const query = inputValue.trim().toLowerCase();
  const matchingOptions = options.filter(
    (o) =>
      !selectedSet.has(o.value) &&
      (!query || o.label.toLowerCase().includes(query)),
  );
  const visibleOptions = matchingOptions.slice(0, MAX_VISIBLE);

  // Distinguishes an exhausted catalog from a query with no hits.
  const allSelected =
    matchingOptions.length === 0 && selectedOptions.length === options.length;

  return (
    <Combobox
      multiple
      value={selectedOptions}
      onValueChange={(value: ComboboxOption[]) =>
        onChange(value.map((o) => o.value))
      }
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      disabled={disabled}
      filter={null}
      autoHighlight
    >
      <ComboboxChips
        ref={anchor}
        className={cn("w-full max-w-full", className)}
      >
        {selectedOptions.map((option) => (
          <ComboboxChip key={option.value} className="max-w-44">
            <Tooltip>
              <TooltipTrigger className="min-w-0 truncate">
                {option.label}
              </TooltipTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          </ComboboxChip>
        ))}
        <ComboboxChipsInput
          placeholder={
            selectedOptions.length === 0 ? placeholder : searchPlaceholder
          }
        />
        <ComboboxClear />
        <ComboboxTrigger />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxList>
          {visibleOptions.length === 0 ? (
            <div className="flex w-full justify-center py-2 text-center text-xs/relaxed text-muted-foreground">
              {allSelected ? allSelectedText : emptyText}
            </div>
          ) : (
            <>
              {visibleOptions.map((option) =>
                option.label.length > 150 ? (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>
                      <ComboboxItem value={option}>
                        <span className="min-w-0 flex-1 truncate">
                          {option.label}
                        </span>
                      </ComboboxItem>
                    </TooltipTrigger>
                    <TooltipContent>{option.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  <ComboboxItem key={option.value} value={option}>
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                  </ComboboxItem>
                ),
              )}
              {matchingOptions.length > MAX_VISIBLE && (
                <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Showing {visibleOptions.length} of {matchingOptions.length}
                  . Type to refine.
                </div>
              )}
            </>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
