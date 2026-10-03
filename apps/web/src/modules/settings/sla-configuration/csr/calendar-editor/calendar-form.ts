import {
  validateWeeklyWindows,
  WeeklyWindowValidationError,
  type WeeklyWindow,
} from "@sla/core";
import type { BusinessCalendarOption } from "@/lib/types/sla-configuration";

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
export interface DayWindowState {
  openTime: string;
  closeTime: string;
  fullDay: boolean;
}

export type DayState = DayWindowState[];

export type CalendarHoliday = BusinessCalendarOption["holidays"][number];

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

export function initialCalendarFormState(
  calendar: BusinessCalendarOption | undefined,
) {
  return {
    name: calendar?.name ?? "",
    timezone: calendar?.timezone ?? "UTC",
    days: initialDays(calendar?.weekly ?? []),
    holidays: calendar?.holidays ?? [],
  };
}

export type CalendarFormState = ReturnType<typeof initialCalendarFormState>;

export function newWindow(): DayWindowState {
  return { openTime: "09:00", closeTime: "17:00", fullDay: false };
}

/**
 * Turns the per-day editor rows into the engine's weekly windows and
 * validates them, returning the first problem to show instead.
 */
export function buildWeeklyWindows(
  days: DayState[],
): { error: string } | { weekly: WeeklyWindow[] } {
  const weekly: WeeklyWindow[] = [];
  for (let day = 0; day < days.length; day += 1) {
    for (const w of days[day]!) {
      weekly.push(
        w.fullDay
          ? {
              day: day as WeeklyWindow["day"],
              openMinute: 0,
              closeMinute: 1440,
            }
          : {
              day: day as WeeklyWindow["day"],
              openMinute: timeToMinutes(w.openTime),
              closeMinute: timeToMinutes(w.closeTime),
            },
      );
    }
  }

  if (weekly.length === 0) {
    return {
      error:
        "Add at least one working-hours window (or leave this calendar Always Open instead).",
    };
  }
  try {
    validateWeeklyWindows(weekly);
  } catch (validationError) {
    return {
      error:
        validationError instanceof WeeklyWindowValidationError
          ? validationError.message
          : "Working hours are invalid.",
    };
  }

  return { weekly };
}
