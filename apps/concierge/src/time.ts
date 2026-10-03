import type { WeeklyWindow } from "@sla/core";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function offsetMinutes(instantMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  for (const part of formatter.formatToParts(instantMs)) parts[part.type] = Number(part.value);
  const localAsUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!);
  return Math.round((localAsUtc - Math.floor(instantMs / 60_000) * 60_000) / 60_000);
}

/** A wall-clock time in `timeZone` as a UTC instant. Two passes settle DST boundaries. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = asUtc - offsetMinutes(asUtc, timeZone) * 60_000;
  guess = asUtc - offsetMinutes(guess, timeZone) * 60_000;
  return guess;
}

/**
 * Lenient timestamp parsing for the formats exports actually use. Returns an
 * ISO string, or null when the value matches none of them (the caller counts
 * the row as dropped rather than guessing).
 *
 * - ISO 8601 with an offset or `Z`: taken as is.
 * - `YYYY-MM-DD HH:MM[:SS]` with no offset: wall-clock time in `timeZone`.
 * - Jira's `DD/Mon/YY h:mm AM` export format: wall-clock time in `timeZone`.
 */
export function parseTimestamp(value: string, timeZone: string): string | null {
  const text = value.trim();

  const iso = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (iso) {
    const [, y, mo, d, h = "0", mi = "0", s = "0", zone] = iso;
    if (zone) {
      const offset = zone.toUpperCase() === "Z" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
      const ms = Date.parse(`${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}:${s.padStart(2, "0")}${offset}`);
      return Number.isNaN(ms) ? null : new Date(ms).toISOString();
    }
    return validLocal(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s), timeZone);
  }

  const jira = text.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (jira) {
    const [, d, monName, yRaw, hRaw, mi, s = "0", meridiem] = jira;
    const month = MONTHS[monName!.toLowerCase()];
    if (!month) return null;
    const year = yRaw!.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    let hour = Number(hRaw);
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
    }
    return validLocal(year, month, Number(d), hour, Number(mi), Number(s), timeZone);
  }

  return null;
}

function validLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day) return null;
  return new Date(zonedToUtc(year, month, day, hour, minute, second, timeZone)).toISOString();
}

/**
 * `90`, `90m`, `4h`, `2d`, `1d4h30m` → minutes. A day is 24 hours: with
 * business hours, write a "3 business day" target as the working hours it
 * stands for (e.g. `24h` for three 8-hour days), same as Zendesk's own
 * business-hours targets.
 */
export function parseDuration(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/);
  if (!match || text === "") return null;
  const [, d = "0", h = "0", m = "0"] = match;
  const minutes = Number(d) * 1440 + Number(h) * 60 + Number(m);
  return minutes > 0 ? minutes : null;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parseClock(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= 1440 && Number(match[2]) < 60 ? minutes : null;
}

/**
 * `mon-fri 09:00-17:00; sat 10:00-14:00` → weekly windows. Day ranges wrap
 * (`fri-mon`); a window must close after it opens on the same day.
 */
export function parseBusinessHours(spec: string): WeeklyWindow[] {
  const windows: WeeklyWindow[] = [];
  for (const part of spec.split(";").map((p) => p.trim()).filter(Boolean)) {
    const match = part.toLowerCase().match(/^([a-z]{3})(?:-([a-z]{3}))?\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
    if (!match) throw new Error(`Can't read business hours "${part}". Expected e.g. "mon-fri 09:00-17:00".`);
    const [, fromDay, toDay = fromDay, open, close] = match;
    const from = WEEKDAYS.indexOf(fromDay as (typeof WEEKDAYS)[number]);
    const to = WEEKDAYS.indexOf(toDay as (typeof WEEKDAYS)[number]);
    const openMinute = parseClock(open!);
    const closeMinute = parseClock(close!);
    if (from < 0 || to < 0) throw new Error(`Unknown weekday in "${part}". Use sun, mon, tue, wed, thu, fri, sat.`);
    if (openMinute === null || closeMinute === null || closeMinute <= openMinute) {
      throw new Error(`Invalid hours in "${part}": close must be after open, within one day.`);
    }
    for (let day = from; ; day = (day + 1) % 7) {
      windows.push({ day: day as WeeklyWindow["day"], openMinute, closeMinute });
      if (day === to) break;
    }
  }
  if (windows.length === 0) throw new Error("Business hours are empty.");
  return windows;
}

/** "1d 2h 3m", matching apps/web's `formatMinutes`. */
export function formatMinutes(totalMinutes: number): string {
  const abs = Math.round(Math.abs(totalMinutes));
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const minutes = abs % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return (totalMinutes < 0 ? "-" : "") + parts.join(" ");
}
