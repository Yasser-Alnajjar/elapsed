import { isValidTimeZone } from "@sla/core";
import { z } from "zod";

/**
 * Organization name and display timezone (roadmap 5.8). The timezone is the
 * application-wide display default: user-facing dates and times are shown in
 * it, timezone pickers start on it (a new business calendar), the dashboard
 * groups days by it (roadmap 6.5) and the monthly report uses it for month
 * boundaries and its delivery period. It is never read by SLA calculations,
 * which stay pinned to each business calendar's own timezone (see
 * `packages/commitments/src/pipeline.ts`), and it never alters stored UTC
 * timestamps.
 */
export const organizationSettingsInputSchema = z.object({
  name: z.string().trim().min(1, "Organization name is required").max(200),
  timezone: z
    .string()
    .refine(isValidTimeZone, { message: "timezone must be a valid IANA time zone name" }),
});
