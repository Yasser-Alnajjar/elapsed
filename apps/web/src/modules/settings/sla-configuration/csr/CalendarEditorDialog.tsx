"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DismissibleAlert } from "@/components/ui/dismissible-alert";
import { Button } from "@/components/ui/button";
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
import {
  buildWeeklyWindows,
  initialCalendarFormState,
  type DayState,
} from "./calendar-editor/calendar-form";
import { HolidaysEditor } from "./calendar-editor/HolidaysEditor";
import { WorkingHoursEditor } from "./calendar-editor/WorkingHoursEditor";

interface CalendarEditorDialogProps {
  mode: "create" | "edit";
  calendar?: BusinessCalendarOption;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function CalendarEditorDialog({
  mode,
  calendar,
  open,
  onOpenChange,
  onSaved,
}: CalendarEditorDialogProps) {
  const [state, setState] = useState(() => initialCalendarFormState(calendar));
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
    setState(initialCalendarFormState(calendar));
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

    const built = buildWeeklyWindows(state.days);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    const { weekly } = built;

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

          <WorkingHoursEditor
            days={state.days}
            onUpdateDay={updateDay}
            disabled={saving || isAlwaysOpen}
            alwaysOpen={isAlwaysOpen}
          />

          <HolidaysEditor
            holidays={state.holidays}
            onChange={(updater) =>
              setState((s) => ({ ...s, holidays: updater(s.holidays) }))
            }
            disabled={saving || isAlwaysOpen}
          />

          {error && (
            <DismissibleAlert key={error} variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </DismissibleAlert>
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
