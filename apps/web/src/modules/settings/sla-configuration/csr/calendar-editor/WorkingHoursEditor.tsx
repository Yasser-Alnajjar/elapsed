"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DAY_LABELS,
  newWindow,
  type DayState,
  type DayWindowState,
} from "./calendar-form";

type DayUpdater = (windows: DayState) => DayState;

/** One window's open/close times (or "Open 24 hours"), its 24h toggle and remove button. */
function WindowRow({
  day,
  index,
  window: w,
  onUpdateDay,
  disabled,
}: {
  day: number;
  index: number;
  window: DayWindowState;
  onUpdateDay: (updater: DayUpdater) => void;
  disabled: boolean;
}) {
  const patch = (change: Partial<DayWindowState>) =>
    onUpdateDay((ws) =>
      ws.map((x, i) => (i === index ? { ...x, ...change } : x)),
    );

  return (
    <div className="flex flex-wrap items-center gap-2 ps-1">
      {w.fullDay ? (
        <span className="text-sm text-on-surface-variant sm:w-70">
          Open 24 hours
        </span>
      ) : (
        <>
          <Input
            type="time"
            value={w.openTime}
            onChange={(e) => patch({ openTime: e.target.value })}
            disabled={disabled}
            className="w-32"
          />
          <span className="text-sm text-on-surface-variant">to</span>
          <Input
            type="time"
            value={w.closeTime}
            onChange={(e) => patch({ closeTime: e.target.value })}
            disabled={disabled}
            className="w-32"
          />
        </>
      )}

      <div className="flex items-center gap-1.5">
        <Checkbox
          id={`fullday-${day}-${index}`}
          checked={w.fullDay}
          onCheckedChange={(checked) => patch({ fullDay: checked === true })}
          disabled={disabled}
        />
        <Label
          htmlFor={`fullday-${day}-${index}`}
          className="cursor-pointer whitespace-nowrap text-xs font-normal text-on-surface-variant"
        >
          24 hours
        </Label>
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onUpdateDay((ws) => ws.filter((_, i) => i !== index))}
        disabled={disabled}
      >
        <X />
      </Button>
    </div>
  );
}

/** Per-weekday list of working-hours windows; a day may hold several (split shifts). */
export function WorkingHoursEditor({
  days,
  onUpdateDay,
  disabled,
  alwaysOpen,
}: {
  days: DayState[];
  onUpdateDay: (day: number, updater: DayUpdater) => void;
  disabled: boolean;
  /** An Always Open calendar: the schedule has no effect and is shown read-only. */
  alwaysOpen: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>Working hours</Label>
      <div
        className="space-y-3 rounded-lg bg-surface-container p-3"
        aria-disabled={alwaysOpen}
      >
        {DAY_LABELS.map((label, day) => {
          const windows = days[day]!;
          return (
            <div
              key={label}
              className="space-y-1.5 border-b border-outline-variant/30 pb-2 last:border-0 last:pb-0"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{label}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpdateDay(day, (ws) => [...ws, newWindow()])}
                  disabled={disabled}
                >
                  <Plus /> Add window
                </Button>
              </div>

              {windows.length === 0 && (
                <p className="ps-1 text-xs text-on-surface-variant">Closed</p>
              )}

              {windows.map((w, index) => (
                <WindowRow
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  day={day}
                  index={index}
                  window={w}
                  onUpdateDay={(updater) => onUpdateDay(day, updater)}
                  disabled={disabled}
                />
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-on-surface-variant">
        A day can have more than one window (e.g. a lunch-hour split shift) —
        add as many as this calendar needs.
      </p>
    </div>
  );
}
