import { isValidTimeZone } from "@sla/core";
import { z } from "zod";

/**
 * Organization name and display timezone (roadmap 5.8). The timezone is
 * display-only — it groups days on the dashboard (roadmap 6.5) and is never
 * read by SLA calculations, which stay pinned to each calendar's own
 * timezone (see `packages/commitments/src/pipeline.ts`).
 */
export const organizationSettingsInputSchema = z.object({
  name: z.string().trim().min(1, "Organization name is required").max(200),
  timezone: z
    .string()
    .refine(isValidTimeZone, { message: "timezone must be a valid IANA time zone name" }),
});
