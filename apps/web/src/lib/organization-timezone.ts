import "server-only";
import { cache } from "react";
import { getPrismaClient } from "@sla/db";
import { DEFAULT_DISPLAY_TIMEZONE } from "./display-timezone";
import { getRequestContext } from "./request-context";

/**
 * The signed-in organization's display timezone (`Organization.timezone`) —
 * the single source every server-rendered page and layout reads, and what
 * `OrgTimezoneProvider` hands to client components. Memoized per request.
 * Falls back to UTC if the organization row is missing so a render never
 * fails on it. Display only: SLA arithmetic uses each calendar's own
 * timezone (see `@/lib/organization-settings`).
 */
export const getOrganizationTimezone = cache(async (): Promise<string> => {
  const { organizationId } = await getRequestContext();
  const organization = await getPrismaClient().organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return organization?.timezone ?? DEFAULT_DISPLAY_TIMEZONE;
});
