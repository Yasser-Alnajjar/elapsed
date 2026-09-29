import type { BusinessCalendarVersion, NormalizedState, SLAPolicyVersion } from "@sla/core";
// The product's own defaults for Zendesk-imported policies.
import { WARN_AT_PERCENT } from "@sla/zendesk/src/policies";
import { isValidTimeZone, parseBusinessHours, parseDuration } from "./time";

export const CALENDAR_ID = "concierge-calendar";

export interface ResolutionTarget {
  /** Lowercased Zendesk priority, or null for the fallback target. */
  priority: string | null;
  minutes: number;
}

/**
 * `--resolution 24h` (one target for every ticket) or
 * `--resolution "urgent=4h, high=8h, default=24h"` (per priority; `default`
 * or `*` covers the rest). Without a default, tickets at other priorities
 * get no target and are counted, not evaluated.
 */
export function parseResolutionTargets(spec: string): ResolutionTarget[] {
  const targets: ResolutionTarget[] = [];
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    const priorityText = eq >= 0 ? part.slice(0, eq).trim().toLowerCase() : "default";
    const minutes = parseDuration(eq >= 0 ? part.slice(eq + 1) : part);
    if (!priorityText || minutes === null) {
      throw new Error(`Can't read resolution target "${part}". Expected e.g. "24h" or "urgent=4h".`);
    }
    const priority = priorityText === "default" || priorityText === "*" ? null : priorityText;
    if (targets.some((t) => t.priority === priority)) {
      throw new Error(`Resolution target for "${priority ?? "default"}" is given twice.`);
    }
    targets.push({ priority, minutes });
  }
  if (targets.length === 0) throw new Error("--resolution is empty.");
  return targets;
}

/**
 * The concierge analysis keeps pausing on Pending (its leg split reports
 * waiting-on-customer time). The product's imported Zendesk policies stopped
 * pausing on Pending in H-12 to match Zendesk's own SLA view; revisit this if
 * the concierge's comparison against Zendesk's breach flag should mirror that.
 */
const CONCIERGE_PAUSE_ON_STATES: NormalizedState[] = ["pending_customer"];

/**
 * One `SLAPolicyVersion` per target, shaped like the Zendesk importer's
 * per-priority policies so the core's `matchPolicyVersion` picks the
 * priority-specific one over the fallback.
 */
export function buildPolicyVersions(targets: ResolutionTarget[]): SLAPolicyVersion[] {
  return targets.map((target) => {
    const id = `concierge-resolution-${target.priority ?? "default"}`;
    return {
      id,
      policyId: id,
      version: 1,
      match: target.priority ? { priority: [target.priority] } : {},
      targets: [{ kind: "resolution", minutes: target.minutes }],
      pauseOnStates: CONCIERGE_PAUSE_ON_STATES,
      calendarVersionId: CALENDAR_ID,
      warnAtPercent: WARN_AT_PERCENT,
      effectiveFrom: "1970-01-01T00:00:00.000Z",
    };
  });
}

export function buildCalendar(options: {
  timeZone: string;
  businessHours?: string;
  holidays?: string;
}): BusinessCalendarVersion {
  if (!isValidTimeZone(options.timeZone)) throw new Error(`Unknown time zone "${options.timeZone}".`);
  const holidays = (options.holidays ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  for (const holiday of holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) throw new Error(`Holiday "${holiday}" must be YYYY-MM-DD.`);
  }
  const alwaysOpen = !options.businessHours;
  return {
    id: CALENDAR_ID,
    version: 1,
    timezone: options.timeZone,
    weekly: alwaysOpen ? [] : parseBusinessHours(options.businessHours!),
    holidays,
    alwaysOpen,
  };
}
