/** Whether `Intl` recognizes `timeZone` as a valid IANA time zone identifier (or legacy alias it still resolves). Shared by every layer that accepts a timezone string — the calendar API, the timezone picker, and the Zendesk business-hours importer's normalizer. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Constructing an Intl.DateTimeFormat is far more expensive than using one.
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar date `instant` falls on in `timeZone`, as `YYYY-MM-DD`
 * (Phase 6.5) — the dashboard's day-bucketing (Breaches Over Time, the
 * Compliance Trend chart) groups by this instead of the UTC date, so a
 * customer in a timezone far from UTC doesn't see "today's" breaches split
 * across two bars. `en-CA` is used only because that locale's
 * `toLocaleDateString` output happens to already be `YYYY-MM-DD` — no
 * Canada-specific meaning. Falls back to the UTC date for an unrecognized
 * zone rather than throwing, matching `isValidTimeZone`'s callers, which
 * validate zones before they're saved — a bad zone reaching here would be a
 * bug elsewhere, not a reason to crash a dashboard render.
 */
export function localDateKey(instant: Date, timeZone: string): string {
  let formatter = dateKeyFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    dateKeyFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in milliseconds (negative to the west). */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of offsetFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wallAsUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  // Whole seconds only: `instant` may carry milliseconds the formatter drops.
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which `year`-`month`-`day` begins on `timeZone`'s wall clock (`month` is 1-12). */
export function startOfLocalDay(year: number, month: number, day: number, timeZone: string): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day);
  const first = wallAsUtc - timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  // The offset can differ at the answer itself when a DST change falls in between.
  const second = wallAsUtc - timeZoneOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** The calendar month `instant` falls in on `timeZone`'s wall clock, as `YYYY-MM`. */
export function localMonthKey(instant: Date, timeZone: string): string {
  return localDateKey(instant, timeZone).slice(0, 7);
}

export interface MonthBounds {
  /** `YYYY-MM`. */
  period: string;
  /** First instant of the month on the zone's wall clock. */
  start: Date;
  /** First instant of the next month: the exclusive end. */
  end: Date;
}

/** The instants a calendar month (`YYYY-MM`) starts and ends at on `timeZone`'s wall clock. Months have 28-31 days and can span a DST change, so this is not a fixed number of milliseconds. */
export function monthBounds(period: string, timeZone: string): MonthBounds {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`Invalid month "${period}": expected YYYY-MM`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid month "${period}": expected YYYY-MM`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { period, start: startOfLocalDay(year, month, 1, timeZone), end: startOfLocalDay(nextYear, nextMonth, 1, timeZone) };
}

/** The calendar month before the one `now` is in, on `timeZone`'s wall clock: the month a monthly report covers. */
export function previousMonth(now: Date, timeZone: string): MonthBounds {
  const [year, month] = localMonthKey(now, timeZone).split("-").map(Number) as [number, number];
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return monthBounds(`${previous.year}-${String(previous.month).padStart(2, "0")}`, timeZone);
}
