import type { BillingInterval, PaymentMethod } from "./types/billing";

/**
 * Display formatting for billing, shared by the tenant page and the admin
 * console. Dates are rendered in UTC so the server and the client never
 * disagree during hydration, and so an invoice date reads the same for every
 * viewer.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "$149.00", or "Custom" for a plan without a list price. */
export function formatMoney(cents: number | null, currency = "USD"): string {
  if (cents === null) return "Custom";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** "$514.2K" / "$1.2M": a money headline that has to fit a chip. */
export function formatMoneyCompact(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

/** "$149.00/mo" or "$4,790.00/yr". */
export function formatRate(cents: number | null, interval: BillingInterval, currency = "USD"): string {
  if (cents === null) return "Custom";
  return `${formatMoney(cents, currency)}/${interval === "month" ? "mo" : "yr"}`;
}

/** "41.9k", "100k", "2.4M"; plain digits below a thousand. */
export function formatCount(value: number): string {
  if (Math.abs(value) < 1000) return String(value);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
    .format(value)
    .replace("K", "k");
}

/** "41,894". */
export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Whole percent of a quota, clamped to 0–100; 0 when the limit is unlimited or zero. */
export function percentOf(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/** "41.9%": one decimal place, for the headline ratios. */
export function formatPercent(used: number, limit: number): string {
  if (limit <= 0) return "0%";
  return `${(Math.round((used / limit) * 1000) / 10).toFixed(1)}%`;
}

/** "Oct 28, 2026" (UTC calendar date), or "—". */
export function formatBillingDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "Oct 28" (UTC), for axis labels. */
export function formatBillingDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** "Sep 28, 2026 00:14 UTC". */
export function formatBillingDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  return `${formatBillingDate(iso)} ${time} UTC`;
}

/** "2026-10-02 14:32:01 UTC": the ledger form, sortable by eye. */
export function formatLedgerTimestamp(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** Whole days from `from` to `to` (negative when `to` is earlier), counted in UTC calendar days. */
export function daysBetween(from: string | Date, to: string | Date): number {
  const start = new Date(from);
  const end = new Date(to);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.round((endDay - startDay) / MS_PER_DAY);
}

/** "68h 12m" for a span in milliseconds; "0m" once it has passed. */
export function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

/** "2d 18h" for a span in milliseconds. */
export function formatDaysHours(ms: number): string {
  const totalHours = Math.max(0, Math.floor(ms / 3_600_000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

/** "08/29". */
export function formatCardExpiry(method: Pick<PaymentMethod, "expMonth" | "expYear">): string {
  if (method.expMonth === null || method.expYear === null) return "—";
  return `${String(method.expMonth).padStart(2, "0")}/${String(method.expYear % 100).padStart(2, "0")}`;
}

/** "Visa ···· 4242". */
export function formatPaymentMethod(method: Pick<PaymentMethod, "brand" | "last4">): string {
  return `${method.brand} ···· ${method.last4}`;
}
