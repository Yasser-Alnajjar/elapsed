"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_DISPLAY_TIMEZONE, resolveDisplayTimeZone } from "@/lib/display-timezone";

const OrgTimezoneContext = createContext<string>(DEFAULT_DISPLAY_TIMEZONE);

/**
 * Makes the organization's display timezone (`Organization.timezone`) available
 * to every client component below it. Mounted once per signed-in layout with a
 * server-resolved value, so the first render — server and browser — already has
 * it: no loading state, no hydration mismatch.
 */
export function OrgTimezoneProvider({ timezone, children }: { timezone: string; children: ReactNode }) {
  return <OrgTimezoneContext.Provider value={resolveDisplayTimeZone(timezone)}>{children}</OrgTimezoneContext.Provider>;
}

/** The organization's display timezone: the default for timezone selectors and the zone user-facing dates are shown in. */
export function useOrgTimezone(): string {
  return useContext(OrgTimezoneContext);
}
