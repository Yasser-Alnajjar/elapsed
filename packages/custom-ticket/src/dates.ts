import { MappingError } from "./errors";

export type DateFormat = "iso8601" | "epoch_seconds" | "epoch_millis" | "local";

const formatters = new Map<string, Intl.DateTimeFormat>();

/** True when `timeZone` is an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    zoneFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset of `timeZone` from UTC at `instantMs`, in minutes (positive east of UTC). */
function offsetMinutes(timeZone: string, instantMs: number): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

interface LocalFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millis: number;
}

/**
 * Resolves a wall-clock time in an IANA zone to the one instant it names. A
 * time inside a DST gap does not exist and a time inside a DST overlap names
 * two instants: both are rejected, never resolved by picking one (plan 09, 4.6).
 */
export function localToInstant(fields: LocalFields, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) throw new MappingError("invalid_timezone");
  const guess = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second, fields.millis);
  const offsets = new Set([offsetMinutes(timeZone, guess - 86_400_000), offsetMinutes(timeZone, guess + 86_400_000)]);
  const candidates = new Set<number>();
  for (const offset of offsets) {
    const instant = guess - offset * 60_000;
    if (offsetMinutes(timeZone, instant) === offset) candidates.add(instant);
  }
  if (candidates.size === 0) throw new MappingError("nonexistent_local_time");
  if (candidates.size > 1) throw new MappingError("ambiguous_local_time");
  return new Date([...candidates][0]!);
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

function checkCalendar(f: LocalFields): void {
  const probe = new Date(Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second, f.millis));
  if (
    probe.getUTCFullYear() !== f.year ||
    probe.getUTCMonth() !== f.month - 1 ||
    probe.getUTCDate() !== f.day ||
    f.hour > 23 ||
    f.minute > 59 ||
    f.second > 59
  ) {
    throw new MappingError("invalid_date");
  }
}

function offsetToMinutes(token: string): number {
  if (token === "Z" || token === "z") return 0;
  const sign = token[0] === "-" ? -1 : 1;
  const digits = token.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  if (hours > 23 || minutes > 59) throw new MappingError("invalid_date");
  return sign * (hours * 60 + minutes);
}

const MIN_YEAR = 1970;
const MAX_YEAR = 2200;

function finish(date: Date): Date {
  const year = date.getUTCFullYear();
  if (Number.isNaN(date.getTime()) || year < MIN_YEAR || year > MAX_YEAR) throw new MappingError("invalid_date");
  return date;
}

/**
 * Parses one source date value.
 * - `iso8601`: an offset (or `Z`) is used as given. With no offset the value
 *   is a wall-clock time and `timezone` is REQUIRED (`timezone_required`);
 *   UTC and the organization's zone are never assumed.
 * - `epoch_seconds` / `epoch_millis`: a finite number or an integer string.
 * - `local`: always a wall-clock time in `timezone` (required).
 * A number under `iso8601` is refused (`date_format_required`): seconds and
 * milliseconds cannot be told apart by magnitude without guessing.
 */
export function parseDateValue(value: unknown, options: { format: DateFormat; timezone: string | null }): Date {
  const { format, timezone } = options;
  if (format === "epoch_seconds" || format === "epoch_millis") {
    const n = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(n)) throw new MappingError("invalid_date");
    return finish(new Date(format === "epoch_seconds" ? Math.round(n * 1000) : Math.round(n)));
  }
  if (typeof value === "number") throw new MappingError("date_format_required");
  if (typeof value !== "string") throw new MappingError("invalid_type");
  const match = ISO.exec(value.trim());
  if (!match) throw new MappingError("invalid_date");
  const fields: LocalFields = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] ? Number(match[4]) : 0,
    minute: match[5] ? Number(match[5]) : 0,
    second: match[6] ? Number(match[6]) : 0,
    millis: match[7] ? Math.floor(Number(`0.${match[7]}`) * 1000) : 0,
  };
  checkCalendar(fields);
  const offsetToken = match[8];
  if (format === "iso8601" && offsetToken) {
    const utc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second, fields.millis);
    return finish(new Date(utc - offsetToMinutes(offsetToken) * 60_000));
  }
  if (format === "local" && offsetToken) throw new MappingError("invalid_date");
  if (timezone === null) throw new MappingError("timezone_required");
  return finish(localToInstant(fields, timezone));
}
