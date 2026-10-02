/**
 * Display formatting for the platform-admin console. Everything here is UTC
 * and static: operators compare timestamps across tenants and across their own
 * tools, so a relative ("2 min ago") or browser-local rendering would be a
 * different answer for every viewer. Rendering in UTC on the server and the
 * client also means the two never disagree during hydration.
 */

const UTC_PARTS = {
  timeZone: "UTC",
  hour12: true,
} as const;

/** "Oct 2, 2026, 07:12:27 AM UTC", or "Never" for a null timestamp. */
export function formatUtcTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  const text = new Date(iso).toLocaleString("en-US", {
    ...UTC_PARTS,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${text} UTC`;
}

/** "Oct 2, 2026" (UTC calendar date). */
export function formatUtcDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "Oct 2, 07:12 AM": the compact form for table cells where the year is noise. */
export function formatUtcShort(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    ...UTC_PARTS,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "07:12:27", the 24-hour UTC time of day. */
export function formatUtcClock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: true });
}

/** First eight characters of an id, for a tight chip. The full id stays in a `title`. */
export function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}

/** "4m 12s" / "36s" / "2h 05m" for a span in milliseconds. */
export function formatSpan(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
