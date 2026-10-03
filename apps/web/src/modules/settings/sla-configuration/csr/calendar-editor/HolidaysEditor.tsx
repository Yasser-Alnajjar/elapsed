"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CalendarHoliday } from "./calendar-form";

/** Editable list of named holidays, each a one-off date or a recurring MM-DD. */
export function HolidaysEditor({
  holidays,
  onChange,
  disabled,
}: {
  holidays: CalendarHoliday[];
  onChange: (
    updater: (holidays: CalendarHoliday[]) => CalendarHoliday[],
  ) => void;
  disabled: boolean;
}) {
  const patch = (index: number, change: Partial<CalendarHoliday>) =>
    onChange((hs) => hs.map((h, i) => (i === index ? { ...h, ...change } : h)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Holidays</Label>
        <Button
          type="button"
          size="sm"
          variant="surface"
          onClick={() =>
            onChange((hs) => [...hs, { date: "", name: "", recurring: false }])
          }
          disabled={disabled}
        >
          <Plus /> Add holiday
        </Button>
      </div>
      {holidays.length > 0 && (
        <div className="space-y-2 rounded-lg bg-surface-container p-3">
          {holidays.map((holiday, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={index} className="flex items-center gap-2">
              <Input
                value={holiday.name}
                onChange={(e) => patch(index, { name: e.target.value })}
                placeholder="Name"
                disabled={disabled}
                className="flex-1"
              />
              <Input
                value={holiday.date}
                onChange={(e) => patch(index, { date: e.target.value })}
                placeholder={holiday.recurring ? "MM-DD" : "YYYY-MM-DD"}
                disabled={disabled}
                className="w-36"
              />
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`holiday-recurring-${index}`}
                  checked={holiday.recurring}
                  onCheckedChange={(checked) =>
                    patch(index, { recurring: checked === true, date: "" })
                  }
                  disabled={disabled}
                />

                <Label
                  htmlFor={`holiday-recurring-${index}`}
                  className="cursor-pointer text-xs font-normal text-on-surface-variant"
                >
                  Recurring
                </Label>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange((hs) => hs.filter((_, i) => i !== index))
                }
                disabled={disabled}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-on-surface-variant">
        A recurring holiday is expanded into concrete dates for the next several
        years when saved.
      </p>
    </div>
  );
}
