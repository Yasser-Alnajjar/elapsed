import { isTicketSourceEvent } from "./ticket-source";
import type { CommitmentKind, NormalizedEvent, NormalizedState, SLAPolicyVersion } from "./types";

interface CommitmentClockRule {
  /** The states that pause this commitment's SLA clock under `policyVersion`. */
  pauseStates(policyVersion: SLAPolicyVersion): NormalizedState[];
}

/**
 * Each commitment kind's own clock rules. Keyed by every `CommitmentKind`, so
 * a new kind does not compile until its pause behavior is defined here — no
 * kind inherits another's by default.
 *
 * - `first_response` never pauses: a customer being asked for more
 *   information doesn't excuse a late first reply.
 * - `resolution` pauses on the policy version's `pauseOnStates`, plus
 *   `resolved` unconditionally (D3): a solve-to-reopen interval never counts
 *   toward Resolution, matching Zendesk. This is independent of
 *   `pauseOnStates` — on-hold (`pending_internal`) is deliberately not
 *   included here (D7) and must stay that way.
 * - `next_reply` never pauses: a reply is owed whatever state the case is in.
 */
const COMMITMENT_CLOCK_RULES: Record<CommitmentKind, CommitmentClockRule> = {
  first_response: { pauseStates: () => [] },
  resolution: {
    pauseStates: (policyVersion) => [...new Set([...policyVersion.pauseOnStates, "resolved" as const])],
  },
  next_reply: { pauseStates: () => [] },
};

/**
 * The states that pause a commitment of `kind` under `policyVersion` — what
 * the SLA clock (`foldClockIntervals`) must be given for that commitment,
 * never `policyVersion.pauseOnStates` directly.
 */
export function pauseStatesFor(kind: CommitmentKind, policyVersion: SLAPolicyVersion): NormalizedState[] {
  return COMMITMENT_CLOCK_RULES[kind].pauseStates(policyVersion);
}

/** Whether a commitment of `kind` under `policyVersion` pauses while the case is in `state`. */
export function commitmentPausesOn(
  kind: CommitmentKind,
  state: NormalizedState,
  policyVersion: SLAPolicyVersion,
): boolean {
  return pauseStatesFor(kind, policyVersion).includes(state);
}

/**
 * The events `foldClockIntervals` should fold for `kind`'s pause detection —
 * ordinarily `events` unchanged, except for `resolution` (D3): `resolved` is
 * a ticket-source-only pause cause, unlike the cross-system
 * `policyVersion.pauseOnStates` (elapsed.ts's "regardless of which system
 * reports it" rule, meant for customer-waiting states like
 * `pending_customer`). A linked Jira issue reaching its own "resolved"
 * category says nothing about whether the Zendesk/Intercom ticket is solved,
 * so its `toState` is neutralized here before folding, leaving every other
 * state transition (including its own pause states) untouched.
 */
export function eventsForPauseFold(kind: CommitmentKind, events: NormalizedEvent[]): NormalizedEvent[] {
  if (kind !== "resolution") return events;
  return events.map((event) =>
    event.toState === "resolved" && !isTicketSourceEvent(event)
      ? { ...event, toState: null }
      : event,
  );
}
