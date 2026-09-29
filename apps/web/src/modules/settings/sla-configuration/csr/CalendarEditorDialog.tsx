"use client";

import { AlertCircle, Loader2, Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { validateWeeklyWindows, WeeklyWindowValidationError, type WeeklyWindow } from "@sla/core";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimezoneCombobox } from "@/components/shared/timezone-combobox";
import type { BusinessCalendarOption } from "@/lib/types/sla-configuration";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarEditorDialogProps {
  mode: "create" | "edit";
  calendar?: BusinessCalendarOption;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** One working-hours window in a day's editor state. `fullDay` represents an exact 24h window (`openMinute: 0, closeMinute: 1440`) — the one case `<input type="time">` can't express on its own (it tops out at 23:59), so it's tracked separately rather than losing the last minute of the day (4e). */
interface DayWindowState {
  openTime: string;
  closeTime: string;
  fullDay: boolean;
}

type DayState = DayWindowState[];

function windowToState(w: WeeklyWindow): DayWindowState {
  const fullDay = w.openMinute === 0 && w.closeMinute === 1440;
  return {
    fullDay,
    openTime: fullDay ? "00:00" : minutesToTime(w.openMinute),
    closeTime: fullDay ? "23:59" : minutesToTime(w.closeMinute),
  };
}

/** Preserves every existing window per day, in order — editing one split-shift window must never silently drop another (4c). */
function initialDays(weekly: WeeklyWindow[]): DayState[] {
  return DAY_LABELS.map((_, day) =>
    weekly
      .filter((w) => w.day === day)
      .sort((a, b) => a.openMinute - b.openMinute)
      .map(windowToState),
  );
}

function initialState(calendar: BusinessCalendarOption | undefined) {
  return {
    name: calendar?.name ?? "",
    timezone: calendar?.timezone ?? "UTC",
    days: initialDays(calendar?.weekly ?? []),
    holidays: calendar?.holidays ?? [],
  };
}

function newWindow(): DayWindowState {
  return { openTime: "09:00", closeTime: "17:00", fullDay: false };
}

export function CalendarEditorDialog({
  mode,
  calendar,
  open,
  onOpenChange,
  onSaved,
}: CalendarEditorDialogProps) {
  const [state, setState] = useState(() => initialState(calendar));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 4a: an Always Open calendar's weekly hours, timezone, and holidays are
  // never read by the engine (`computeDeadline`/`workingMinutesBetween`
  // short-circuit before touching any of them) — editing them here would be
  // purely cosmetic and misleading, so the whole schedule section is
  // disabled and explained instead. `alwaysOpen` itself is never editable —
  // there is no path in this dialog that can set or clear it.
  const isAlwaysOpen = mode === "edit" && calendar?.alwaysOpen === true;

  useEffect(() => {
    if (!open) return;
    setState(initialState(calendar));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function updateDay(day: number, updater: (windows: DayState) => DayState) {
    setState((s) => ({
      ...s,
      days: s.days.map((windows, i) => (i === day ? updater(windows) : windows)),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    if (state.name.trim().length === 0) {
      setError("Name is required.");
      return;
    }

    // Always Open: nothing else on this form has any effect, so nothing
    // else is sent — nested fields carry forward unchanged server-side.
    if (isAlwaysOpen) {
      setSaving(true);
      setError(null);
      try {
        const result = await Actions.SlaConfiguration.updateCalendar(calendar!.id, {
          name: state.name.trim(),
        });
        if (!result.ok) {
          setError(result.body.error ?? "Failed to save calendar.");
          return;
        }
        onSaved();
      } catch {
        setError("Something went wrong while saving the calendar.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const weekly: WeeklyWindow[] = [];
    for (let day = 0; day < state.days.length; day += 1) {
      for (const w of state.days[day]!) {
        weekly.push(
          w.fullDay
            ? { day: day as WeeklyWindow["day"], openMinute: 0, closeMinute: 1440 }
            : {
                day: day as WeeklyWindow["day"],
                openMinute: timeToMinutes(w.openTime),
                closeMinute: timeToMinutes(w.closeTime),
              },
        );
      }
    }

    if (weekly.length === 0) {
      setError("Add at least one working-hours window (or leave this calendar Always Open instead).");
      return;
    }
    try {
      validateWeeklyWindows(weekly);
    } catch (validationError) {
      setError(
        validationError instanceof WeeklyWindowValidationError
          ? validationError.message
          : "Working hours are invalid.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result =
        mode === "create"
          ? await Actions.SlaConfiguration.createCalendar({
              name: state.name.trim(),
              timezone: state.timezone,
              weekly,
              holidays: state.holidays,
            })
          : await Actions.SlaConfiguration.updateCalendar(calendar!.id, {
              name: state.name.trim(),
              timezone: state.timezone,
              weekly,
              holidays: state.holidays,
            });

      if (!result.ok) {
        setError(result.body.error ?? "Failed to save calendar.");
        return;
      }
      onSaved();
    } catch {
      setError("Something went wrong while saving the calendar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          // Radix sees Escape first (capture phase); while the timezone list
          // is open, let it close just the list, not the whole dialog.
          if (
            event.target instanceof Element &&
            event.target.closest('[aria-expanded="true"]')
          ) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "Create business calendar"
              : `Edit ${calendar?.name}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit" && calendar?.source === "imported"
              ? "This is a Zendesk-imported calendar. Local edits here are never overwritten by the next sync."
              : "Timezone, working hours, and holidays."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {isAlwaysOpen && (
            <Alert>
              <AlertCircle />
              <AlertDescription>
                This calendar is <strong>Always open (24/7)</strong>. Working
                hours, timezone, and holidays below have no effect while
                Always Open is on, so they&apos;re read-only here — only the
                name can be changed.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="calendar-name">Name</Label>
              <Input
                id="calendar-name"
                value={state.name}
                onChange={(e) =>
                  setState((s) => ({ ...s, name: e.target.value }))
                }
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="calendar-timezone">Timezone</Label>
              <TimezoneCombobox
                id="calendar-timezone"
                value={state.timezone}
                onChange={(timezone) => setState((s) => ({ ...s, timezone }))}
                disabled={saving || isAlwaysOpen}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Working hours</Label>
            <div
              className="space-y-3 rounded-lg bg-surface-container p-3"
              aria-disabled={isAlwaysOpen}
            >
              {DAY_LABELS.map((label, day) => {
                const windows = state.days[day]!;
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
                        onClick={() =>
                          updateDay(day, (ws) => [...ws, newWindow()])
                        }
                        disabled={saving || isAlwaysOpen}
                      >
                        <Plus /> Add window
                      </Button>
                    </div>

                    {windows.length === 0 && (
                      <p className="ps-1 text-xs text-on-surface-variant">
                        Closed
                      </p>
                    )}

                    {windows.map((w, index) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <div key={index} className="flex flex-wrap items-center gap-2 ps-1">
                        {w.fullDay ? (
                          <span className="text-sm text-on-surface-variant sm:w-70">
                            Open 24 hours
                          </span>
                        ) : (
                          <>
                            <Input
                              type="time"
                              value={w.openTime}
                              onChange={(e) =>
                                updateDay(day, (ws) =>
                                  ws.map((x, i) =>
                                    i === index
                                      ? { ...x, openTime: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                              disabled={saving || isAlwaysOpen}
                              className="w-32"
                            />
                            <span className="text-sm text-on-surface-variant">
                              to
                            </span>
                            <Input
                              type="time"
                              value={w.closeTime}
                              onChange={(e) =>
                                updateDay(day, (ws) =>
                                  ws.map((x, i) =>
                                    i === index
                                      ? { ...x, closeTime: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                              disabled={saving || isAlwaysOpen}
                              className="w-32"
                            />
                          </>
                        )}

                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id={`fullday-${day}-${index}`}
                            checked={w.fullDay}
                            onCheckedChange={(checked) =>
                              updateDay(day, (ws) =>
                                ws.map((x, i) =>
                                  i === index
                                    ? { ...x, fullDay: checked === true }
                                    : x,
                                ),
                              )
                            }
                            disabled={saving || isAlwaysOpen}
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
                          onClick={() =>
                            updateDay(day, (ws) =>
                              ws.filter((_, i) => i !== index),
                            )
                          }
                          disabled={saving || isAlwaysOpen}
                        >
                          <X />
                        </Button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-on-surface-variant">
              A day can have more than one window (e.g. a lunch-hour split
              shift) — add as many as this calendar needs.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Holidays</Label>
              <Button
                type="button"
                size="sm"
                variant="surface"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    holidays: [
                      ...s.holidays,
                      { date: "", name: "", recurring: false },
                    ],
                  }))
                }
                disabled={saving || isAlwaysOpen}
              >
                <Plus /> Add holiday
              </Button>
            </div>
            {state.holidays.length > 0 && (
              <div className="space-y-2 rounded-lg bg-surface-container p-3">
                {state.holidays.map((holiday, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={holiday.name}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          holidays: s.holidays.map((h, i) =>
                            i === index ? { ...h, name: e.target.value } : h,
                          ),
                        }))
                      }
                      placeholder="Name"
                      disabled={saving || isAlwaysOpen}
                      className="flex-1"
                    />
                    <Input
                      value={holiday.date}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          holidays: s.holidays.map((h, i) =>
                            i === index ? { ...h, date: e.target.value } : h,
                          ),
                        }))
                      }
                      placeholder={holiday.recurring ? "MM-DD" : "YYYY-MM-DD"}
                      disabled={saving || isAlwaysOpen}
                      className="w-36"
                    />
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`holiday-recurring-${index}`}
                        checked={holiday.recurring}
                        onCheckedChange={(checked) =>
                          setState((s) => ({
                            ...s,
                            holidays: s.holidays.map((h, i) =>
                              i === index
                                ? {
                                    ...h,
                                    recurring: checked === true,
                                    date: "",
                                  }
                                : h,
                            ),
                          }))
                        }
                        disabled={saving || isAlwaysOpen}
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
                        setState((s) => ({
                          ...s,
                          holidays: s.holidays.filter((_, i) => i !== index),
                        }))
                      }
                      disabled={saving || isAlwaysOpen}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-on-surface-variant">
              A recurring holiday is expanded into concrete dates for the next
              several years when saved.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="surface"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {saving
                ? "Saving…"
                : mode === "create"
                  ? "Create calendar"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
