import type {
  CommitmentKind,
  PolicyCondition,
  SLAPolicyMatch,
} from "@sla/core";
import {
  INTEGRATION_PROVIDER_LABELS,
  type IntegrationProvider,
} from "./types/integrations";

/** Formats a signed minute count as "1d 2h 3m", dropping leading zero units. */
export function formatMinutes(totalMinutes: number): string {
  const totalSeconds = Math.round(Math.abs(totalMinutes) * 60);

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) {
    parts.push(`${minutes}m`);
  }

  // Show seconds only when there is sub-minute precision.
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return (totalMinutes < 0 ? "-" : "") + parts.join(" ");
}
/**
 * Formats a signed second count for SLA timing: "1m 26s" under an hour, where
 * seconds matter, and "1d 2h 3m" (like `formatMinutes`) beyond it.
 */
export function formatSeconds(totalSeconds: number): string {
  const abs = Math.abs(Math.trunc(totalSeconds));
  if (abs >= 3600)
    return (totalSeconds < 0 ? "-" : "") + formatMinutes(Math.floor(abs / 60));

  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes}m`);
  if (minutes === 0 || seconds > 0) parts.push(`${seconds}s`);

  return (totalSeconds < 0 ? "-" : "") + parts.join(" ");
}

/**
 * Formats a signed second count as fixed-width clock digits — "00:35:09"
 * under a day, "1d 00:35:09" beyond it. Distinct from `formatSeconds`
 * (human-readable "35m 09s"): this is for a dedicated digital-clock display
 * (the case-detail hero runway callout), where Stitch's own mockup renders
 * fixed HH:MM:SS digits rather than a variable-width duration string.
 */
export function formatClockDigits(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.trunc(Math.abs(totalSeconds));

  const days = Math.floor(abs / 86_400);
  const hours = Math.floor((abs % 86_400) / 3_600);
  const minutes = Math.floor((abs % 3_600) / 60);
  const seconds = abs % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return sign + (days > 0 ? `${days}d ${clock}` : clock);
}

const LEG_LABELS: Record<string, string> = {
  support: "Support",
  engineering: "Engineering",
  waiting_customer: "Waiting on customer",
  unknown: "Unknown",
};

export function formatLeg(leg: string): string {
  return LEG_LABELS[leg] ?? leg;
}

/**
 * Maps a raw ticket priority string (Zendesk/Intercom: urgent/high/normal/
 * low/none) to a Stitch-style "P1"/"P2"/"P3" severity label — display-only,
 * not a stored field; never used for matching, sorting weight, or SLA logic.
 */
export type PriorityTier = "P1" | "P2" | "P3" | "P4";

const PRIORITY_TIER_LABELS: Record<string, PriorityTier> = {
  urgent: "P1",
  high: "P2",
  normal: "P3",
  low: "P4",
};

export function formatPriorityTier(
  priority: string | null,
): PriorityTier | null {
  if (!priority) return null;
  return PRIORITY_TIER_LABELS[priority] ?? null;
}

const PRIORITY_TIER_NAMES: Record<PriorityTier, string> = {
  P1: "Critical",
  P2: "High",
  P3: "Normal",
  P4: "Low",
};

/** A tier's plain-language name, e.g. "Critical" for P1. */
export function formatPriorityTierName(tier: PriorityTier): string {
  return PRIORITY_TIER_NAMES[tier];
}

/** Reverse of `formatPriorityTier`: the raw ticket priority strings that map to `tier`, for server-side severity filters. */
export function rawPrioritiesForTier(tier: PriorityTier): string[] {
  return Object.keys(PRIORITY_TIER_LABELS).filter(
    (priority) => PRIORITY_TIER_LABELS[priority] === tier,
  );
}

// Record<CommitmentKind, string>, not Record<string, string>: a new
// CommitmentKind fails to compile here until it's given a label, so this
// can't silently fall behind the engine's own kinds again.
const COMMITMENT_KIND_LABELS: Record<CommitmentKind, string> = {
  first_response: "First response",
  resolution: "Resolution",
  next_reply: "Next reply",
};

export function formatCommitmentKind(kind: CommitmentKind): string {
  return COMMITMENT_KIND_LABELS[kind];
}

/**
 * A Next Reply commitment's 1-based position among a case's Next Reply
 * cycles, ordered by `startedAt` — e.g. "Cycle 1", "Cycle 2" for display
 * only. Purely presentational: derived fresh from already-fetched
 * commitments, never stored, and unrelated to `cycleKey` (the engine's own
 * stable cycle identity). Commitments of other kinds are absent from the map.
 */
export function nextReplyCycleNumbers(
  commitments: { id: string; kind: CommitmentKind; startedAt: string }[],
): Map<string, number> {
  return new Map(
    commitments
      .filter((c) => c.kind === "next_reply")
      .slice()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((c, index) => [c.id, index + 1]),
  );
}

const CONDITION_FIELD_LABELS: Record<string, string> = {
  priority: "Priority",
  status: "Zendesk status",
  type: "Ticket type",
  group_id: "Group",
  assignee_id: "Assignee",
  requester_id: "Requester",
  brand_id: "Brand",
  ticket_form_id: "Ticket form",
  form_id: "Ticket form",
  recipient: "Recipient email",
  tags: "Tags",
  current_tags: "Tags",
  via_id: "Channel",
  current_via_id: "Channel",
};

/** A raw Zendesk condition field (`"group_id"`, `"custom_fields_123"`) in plain language, best-effort for anything not in `CONDITION_FIELD_LABELS`. */
function humanizeConditionField(field: string): string {
  if (CONDITION_FIELD_LABELS[field]) return CONDITION_FIELD_LABELS[field];
  if (field.startsWith("custom_fields_")) {
    return `Custom field ${field.slice("custom_fields_".length)}`;
  }
  return field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Every operator `matchesCondition` (@sla/core) actually implements — see `evaluateCondition` in packages/core/src/commitments.ts. */
const CONDITION_OPERATOR_LABELS: Record<string, string> = {
  is: "is",
  equals: "is",
  is_not: "is not",
  not_equals: "is not",
  includes: "includes",
  contains: "includes",
  not_includes: "does not include",
  not_contains: "does not include",
  less_than: "is less than",
  less_than_equal: "is at most",
  greater_than: "is greater than",
  greater_than_equal: "is at least",
  present: "is set",
  not_present: "is not set",
};

/** One generic condition in plain language, e.g. "Priority is Urgent" or "Group is set". */
function describeCondition(condition: PolicyCondition): string {
  const field = humanizeConditionField(condition.field);
  const operator =
    CONDITION_OPERATOR_LABELS[condition.operator] ?? condition.operator;
  if (
    condition.operator === "present" ||
    condition.operator === "not_present"
  ) {
    return `${field} ${operator}`;
  }
  return `${field} ${operator} ${String(condition.value)}`;
}

function describeConditionGroup(
  conditions: SLAPolicyMatch["conditions"],
): string[] {
  if (!conditions) return [];
  const parts: string[] = [];
  if (conditions.all && conditions.all.length > 0) {
    parts.push(`all of: ${conditions.all.map(describeCondition).join(", ")}`);
  }
  if (conditions.any && conditions.any.length > 0) {
    parts.push(`any of: ${conditions.any.map(describeCondition).join(", ")}`);
  }
  return parts;
}

/**
 * Plain-language description of an SLA policy's match conditions (3.4) —
 * both the legacy `priority`/`tier`/`customerIds` fields (native policies)
 * and the generic `conditions` an imported Zendesk policy carries
 * (`extractMatchFromFilter`, @sla/zendesk).
 */
export function formatPolicyMatch(match: SLAPolicyMatch): string {
  return (
    [
      match.priority && `priority in [${match.priority.join(", ")}]`,
      match.tier && `tier in [${match.tier.join(", ")}]`,
      match.customerIds && "customer-specific",
      ...describeConditionGroup(match.conditions),
    ]
      .filter(Boolean)
      .join(" · ") || "Any case (default)"
  );
}

const COMMITMENT_STATUS_LABELS: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  met: "Met",
  breached: "Breached",
  cancelled: "Cancelled",
};

export function formatCommitmentStatus(status: string): string {
  return COMMITMENT_STATUS_LABELS[status] ?? status;
}

const NORMALIZED_STATE_LABELS: Record<string, string> = {
  new: "New",
  open: "Open",
  pending_customer: "Pending customer",
  pending_internal: "Pending internal",
  in_progress: "In progress",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export function formatNormalizedState(state: string): string {
  return NORMALIZED_STATE_LABELS[state] ?? state;
}

const ACTOR_LABELS: Record<string, string> = {
  customer: "Customer",
  agent: "Agent",
  system: "System",
};

export function formatActor(actor: string): string {
  return ACTOR_LABELS[actor] ?? actor;
}

/** Formats a millisecond interval as e.g. "5 seconds" / "1 hour" — picks the largest unit that divides it evenly. */
export function formatIntervalMs(ms: number): string {
  const units: { ms: number; singular: string }[] = [
    { ms: 24 * 60 * 60_000, singular: "day" },
    { ms: 60 * 60_000, singular: "hour" },
    { ms: 60_000, singular: "minute" },
    { ms: 1_000, singular: "second" },
  ];

  for (const unit of units) {
    if (ms % unit.ms === 0) {
      const count = ms / unit.ms;
      return `${count} ${unit.singular}${count === 1 ? "" : "s"}`;
    }
  }
  return `${Math.round(ms / 1000)} seconds`;
}

/**
 * "Next cycle in ~13 seconds" / "~13 minutes" countdown text for a worker-
 * reported next-run time, relative to `nowMs`. Rounds to the nearest whole
 * unit (seconds under a minute, minutes under an hour, hours beyond);
 * a time that has already passed reads "due now" — the worker's own
 * timer may simply not have fired yet — and null (never armed) reads
 * "pending first cycle".
 */
export function formatNextCycle(nextIso: string | null, nowMs: number): string {
  if (!nextIso) return "Pending first cycle";
  const diffMs = new Date(nextIso).getTime() - nowMs;
  if (diffMs <= 0) return "Next cycle due now";

  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"}`;
  const seconds = Math.round(diffMs / 1_000);
  if (seconds < 60)
    return `Next cycle in ~${plural(Math.max(seconds, 1), "second")}`;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `Next cycle in ~${plural(minutes, "minute")}`;
  return `Next cycle in ~${plural(Math.round(diffMs / 3_600_000), "hour")}`;
}

/** e.g. "Sep 14, 2026, 07:05:32" / "Never" for a null timestamp — a static, second-precision rendering of a worker-reported time. Deliberately not relative: it must not drift or need a client-side tick to stay correct. */
export function formatExactTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
  });
}

/**
 * e.g. "September 14, 2026 at 7:05 AM". The zone is pinned so the server and
 * the browser render the same text; a runtime-local zone would differ between
 * them and cause a hydration mismatch.
 */
export function formatLongDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    timeZone: "Asia/Riyadh",
    numberingSystem: "latn",
  }).format(date);
}

/** The runtime's current UTC offset in `UTC±HH:MM` form, e.g. `UTC+03:00`. */
function formatUtcOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

/**
 * `formatDateTime` with the display timezone's UTC offset appended, e.g.
 * "23 Sep 2026, 1:37 am (UTC+03:00)". `formatDateTime` renders in whatever
 * timezone the runtime is in (`toLocaleString` with no `timeZone`), which can
 * silently differ from a commitment's business calendar (often UTC) — this
 * makes that display timezone explicit wherever the two are shown together.
 */
export function formatDateTimeWithOffset(iso: string): string {
  return `${formatDateTime(iso)} (${formatUtcOffset(new Date(iso))})`;
}

/**
 * The target and deadline line under a commitment's remaining time. Built
 * only from the evaluator's pause-aware fields: a paused clock has no due
 * time to show, so it says when the pause began instead of a fixed deadline.
 */
export function formatCommitmentDeadline(commitment: {
  status: string;
  targetMinutes: number;
  clockState: "running" | "paused" | "stopped";
  pausedSince: string | null;
  effectiveDueAt: string | null;
}): string {
  const target = `Target ${formatMinutes(commitment.targetMinutes)}`;
  if (commitment.status === "breached" && commitment.effectiveDueAt) {
    return `${target} · Breached ${formatDateTimeWithOffset(commitment.effectiveDueAt)}`;
  }
  if (commitment.clockState === "paused" && commitment.pausedSince) {
    return `${target} · Paused since ${formatDateTimeWithOffset(commitment.pausedSince)}, no due time until the clock resumes`;
  }
  if (commitment.clockState === "running" && commitment.effectiveDueAt) {
    return `${target} · Due ${formatDateTimeWithOffset(commitment.effectiveDueAt)}`;
  }
  return target;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMinuteOfDay(minute: number): string {
  const hours = Math.floor(minute / 60);
  const mins = minute % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/** e.g. "Mon 09:00–17:00" for one BusinessCalendarVersion.weekly entry. */
export function formatWeeklyWindow(window: {
  day: number;
  openMinute: number;
  closeMinute: number;
}): string {
  return `${DAY_LABELS[window.day] ?? window.day} ${formatMinuteOfDay(window.openMinute)}–${formatMinuteOfDay(window.closeMinute)}`;
}

// Provider-neutral: "remote_link" covers a Jira remote link and a Linear
// attachment (a URL pointing back at the ticket), "official_link" a ticket
// source's own structured record of the issue (Zendesk's Jira-links registry,
// Intercom's `jira_issue_key`). Which system it is renders separately alongside
// it wherever a CaseLink is displayed.
const CASE_LINK_METHOD_LABELS: Record<string, string> = {
  official_link: "Official link",
  remote_link: "Remote link",
  pattern: "Pattern match",
  manual: "Manually linked",
};

export function formatCaseLinkMethod(method: string): string {
  return CASE_LINK_METHOD_LABELS[method] ?? method;
}

/** The provider's display name; for a Case, the ticket source that created it. */
export function formatTicketSource(system: IntegrationProvider): string {
  return INTEGRATION_PROVIDER_LABELS[system];
}

const TICKET_SOURCE_KEY_PREFIXES: Record<string, string> = {
  zendesk: "ZD",
  intercom: "IC",
};

/** The short label of a ticket source, e.g. "ZD" in "ZD: Open"; its display name when it has no short one. */
export function formatTicketSourceShort(system: IntegrationProvider): string {
  return TICKET_SOURCE_KEY_PREFIXES[system] ?? formatTicketSource(system);
}

/** The key a Case is shown with, in its own ticket source's prefix: "ZD-8921" for Zendesk, "IC-7001" for Intercom; a bare "#id" for a source with none. */
export function formatCaseKey(system: string, externalId: string): string {
  const prefix = TICKET_SOURCE_KEY_PREFIXES[system];
  return prefix ? `${prefix}-${externalId}` : `#${externalId}`;
}

const CASE_TITLE_SUBJECT_MAX = 70;

/** The browser-tab title for a case: its key and subject ("ZD-8921 · Login fails after SSO"), the key alone when the ticket has no subject. */
export function formatCaseTitle(
  system: string,
  externalId: string,
  subject: string | null,
): string {
  const key = formatCaseKey(system, externalId);
  const text = subject?.replace(/\s+/g, " ").trim();
  if (!text) return key;
  const short =
    text.length > CASE_TITLE_SUBJECT_MAX
      ? `${text.slice(0, CASE_TITLE_SUBJECT_MAX - 1).trimEnd()}…`
      : text;
  return short ?? key;
}

const LINKED_SYSTEM_SHORT_LABELS: Record<string, string> = {
  jira: "ENG",
  linear: "LIN",
  github: "GH",
};

/** The short prefix a linked tracker issue is shown with, e.g. "ENG" in "ENG-142". */
export function formatLinkedSystemShort(system: string): string {
  return LINKED_SYSTEM_SHORT_LABELS[system] ?? system.toUpperCase();
}

/** Up to two initials for an avatar: from the name's first two words, else the email's first two letters. */
export function initialsOf(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("");
    if (initials) return initials.toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}
