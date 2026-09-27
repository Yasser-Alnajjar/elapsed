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
