import { isValidTimeZone } from "@sla/core";

/**
 * Fallback display timezone for the rare case the organization's own value is
 * unavailable. The real default everywhere is `Organization.timezone`, supplied
 * by `getOrganizationTimezone()` (server) / `useOrgTimezone()` (client).
 */
export const DEFAULT_DISPLAY_TIMEZONE = "UTC";

/** `timeZone` if it is a valid IANA id, else the UTC fallback — so a missing or corrupt value can never make a formatter throw. */
export function resolveDisplayTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_DISPLAY_TIMEZONE;
}
