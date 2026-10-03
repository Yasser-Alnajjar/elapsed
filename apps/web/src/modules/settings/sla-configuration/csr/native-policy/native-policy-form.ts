import type { CommitmentKind } from "@sla/core";
import { formatCommitmentKind } from "@/lib/format";
import type {
  BusinessCalendarOption,
  SlaPolicySummary,
} from "@/lib/types/sla-configuration";

export const COMMITMENT_KINDS: CommitmentKind[] = [
  "first_response",
  "next_reply",
  "resolution",
];
export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

/**
 * Sentinel Select value for "no explicit calendar" (4i) — the policy then
 * resolves its commitments to the organization's current default calendar,
 * or the system Always Open calendar when the organization has none, fresh
 * at commitment-creation time rather than a calendar frozen in at save time.
 */
export const USE_ORGANIZATION_DEFAULT = "__use_organization_default__";

export interface PolicyFormState {
  name: string;
  includedKinds: Set<CommitmentKind>;
  minutesByKind: Record<string, string>;
  priorities: Set<string>;
  customerIds: Set<string>;
  calendarId: string;
  warnAtPercent: string;
}

export function calendarLabel(calendar: BusinessCalendarOption): string {
  const sourceLabel = calendar.source === "imported" ? "Imported" : "Native";
  return calendar.alwaysOpen
    ? `${calendar.name} (24/7) — ${sourceLabel}`
    : `${calendar.name} — ${calendar.timezone} — ${sourceLabel}`;
}

export function initialPolicyFormState(
  policy: SlaPolicySummary | undefined,
): PolicyFormState {
  if (policy) {
    return {
      name: policy.name,
      includedKinds: new Set(policy.targets.map((t) => t.kind)),
      minutesByKind: Object.fromEntries(
        policy.targets.map((t) => [t.kind, String(t.minutes)]),
      ),
      priorities: new Set(policy.match.priority ?? []),
      customerIds: new Set(policy.match.customerIds ?? []),
      calendarId: policy.usesOrganizationDefaultCalendar
        ? USE_ORGANIZATION_DEFAULT
        : policy.calendarId,
      warnAtPercent: policy.warnAtPercent.join(", "),
    };
  }
  return {
    name: "",
    includedKinds: new Set(),
    minutesByKind: {},
    priorities: new Set(),
    customerIds: new Set(),
    // 4i: a new policy defaults to tracking the organization's default
    // calendar dynamically, not a snapshot frozen in at creation — the
    // admin can still explicitly pin a specific calendar below.
    calendarId: USE_ORGANIZATION_DEFAULT,
    warnAtPercent: "50, 80, 95",
  };
}

export interface PolicyPayload {
  name: string;
  match: { priority?: string[]; customerIds?: string[] };
  targets: { kind: CommitmentKind; minutes: number }[];
  /** Null when the policy follows the organization default calendar (4i). */
  explicitCalendarId: string | null;
  warnAtPercent: number[];
}

/** Checks the form in the order its errors are reported, and builds the request payload once it is valid. */
export function validatePolicyForm(
  state: PolicyFormState,
): { error: string } | { payload: PolicyPayload } {
  if (state.name.trim().length === 0) {
    return { error: "Name is required." };
  }
  if (state.includedKinds.size === 0) {
    return { error: "Set a target for at least one commitment." };
  }
  if (!state.calendarId) {
    return { error: "Choose a calendar." };
  }

  const targets: { kind: CommitmentKind; minutes: number }[] = [];
  for (const kind of state.includedKinds) {
    const minutes = Number(state.minutesByKind[kind]);
    if (
      !Number.isFinite(minutes) ||
      !Number.isInteger(minutes) ||
      minutes <= 0
    ) {
      return {
        error: `Enter a positive whole number of minutes for ${formatCommitmentKind(kind).toLowerCase()}.`,
      };
    }
    targets.push({ kind, minutes });
  }

  const warnAtPercent = state.warnAtPercent
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
  if (warnAtPercent.some((p) => !Number.isInteger(p) || p <= 0 || p > 100)) {
    return {
      error: "Warning thresholds must be whole percentages between 1 and 100.",
    };
  }

  return {
    payload: {
      name: state.name.trim(),
      match: {
        priority: state.priorities.size > 0 ? [...state.priorities] : undefined,
        customerIds:
          state.customerIds.size > 0 ? [...state.customerIds] : undefined,
      },
      targets,
      explicitCalendarId:
        state.calendarId === USE_ORGANIZATION_DEFAULT ? null : state.calendarId,
      warnAtPercent,
    },
  };
}
