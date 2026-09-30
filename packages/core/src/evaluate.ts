import { computeDeadline, workingMinutesBetween } from "./calendar";
import { eventsForPauseFold, pauseStatesFor } from "./clock-rules";
import { foldClockIntervals, sumRunningWorkingMinutes } from "./elapsed";
import { compareNormalizedEvents } from "./ordering";
import { deriveNextReplyCycles } from "./reply-cycles";
import type {
  BusinessCalendarVersion,
  ClockState,
  Commitment,
  CommitmentKind,
  CommitmentStatus,
  Evaluation,
  EvaluationEventRef,
  NormalizedEvent,
  SLAPolicyVersion,
} from "./types";
import { isTicketSourceEvent } from "./ticket-source";
import { stableHash } from "./util";

/**
 * Sentinel `warnThresholdCrossed` value for a breach, stored as the
 * `threshold` on a `Notification` row (Phase 13.7). Safe as a fixed 100:
 * `warnAtPercent` values are always below 100 by construction (they gate
 * "at_risk", which requires `remainingMinutes > 0`), so it never collides
 * with a real warn threshold.
 */
export const BREACH_NOTIFICATION_THRESHOLD = 100;

/**
 * Fixed warn threshold for the engineering-leg OLA target (roadmap step 16).
 * Not configurable — "one optional target duration per engineering leg, not
 * a policy builder" rules out a per-org `warnAtPercent` array here.
 */
export const ENGINEERING_LEG_WARN_AT_PERCENT = 80;

export interface EngineeringLegEvaluation {
  targetMinutes: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  status: "on_track" | "at_risk" | "met" | "breached";
  breachedByMinutes?: number;
}

/**
 * Evaluates an optional engineering-leg OLA target against the cumulative
 * minutes a case has spent in the engineering leg (`sumLegMinutes` in
 * `legs.ts`). Mirrors `evaluateCommitment`'s status ladder
 * (`on_track → at_risk → met | breached`) but has no policy/calendar of its
 * own — `elapsedMinutes` is plain wall-clock time, not working minutes,
 * matching how the dashboard's existing "aging in engineering" metric is
 * already computed (`minutesBetween`, not calendar-aware).
 *
 * `legIsOpen` is whether the case is *currently* in the engineering leg: a
 * breach is permanent once minutes exceed target, but "met" only applies
 * once the leg has actually closed under target — a case still inside the
 * leg is `at_risk`/`on_track`, never `met`.
 */
export function evaluateEngineeringLegTarget(
  elapsedMinutes: number,
  targetMinutes: number,
  legIsOpen: boolean,
): EngineeringLegEvaluation {
  const remainingMinutes = targetMinutes - elapsedMinutes;

  let status: EngineeringLegEvaluation["status"];
  if (remainingMinutes < 0) {
    status = "breached";
  } else if (!legIsOpen) {
    status = "met";
  } else {
    const percentConsumed = (elapsedMinutes / targetMinutes) * 100;
    status = percentConsumed >= ENGINEERING_LEG_WARN_AT_PERCENT ? "at_risk" : "on_track";
  }

  return {
    targetMinutes,
    elapsedMinutes,
    remainingMinutes,
    status,
    breachedByMinutes: remainingMinutes < 0 ? -remainingMinutes : undefined,
  };
}

/** Event types that carry the ticket source's own view of the case's lifecycle state. */
const TICKET_LIFECYCLE_EVENT_TYPES = new Set<NormalizedEvent["type"]>([
  "case_created",
  "state_changed",
  "case_closed",
]);

/**
 * The event that closed the case, if it is closed as of `asOf`: the first
 * ticket-source `case_closed` of the *current*
 * closure, or null if none has happened yet or the case is currently open.
 *
 * Only the ticket source ever anchors a case's lifecycle — a linked Jira issue is
 * never the anchor, and its normalizer never emits `case_created`/
 * `case_closed` (packages/jira/src/normalize.ts) — so a Jira transition
 * (e.g. reaching its own "done" category) can never close or reopen a case
 * here, regardless of when it lands relative to Zendesk's own events.
 *
 * Open vs closed is decided by the *most recent* lifecycle event, not
 * merely "did a case_closed ever happen", which is what lets a Zendesk
 * ticket that was solved and later reopened correctly resume SLA tracking
 * instead of staying permanently resolved.
 *
 * But the event returned is the earliest `case_closed` in the unbroken run
 * of closes ending at that most recent event: Zendesk's solved -> closed
 * (typically an automation days later) is a second `case_closed` that
 * doesn't reopen anything, so the case closed at the solve, not the
 * auto-close.
 */
export function findCaseCloseEvent(
  events: NormalizedEvent[],
  asOf: string,
): NormalizedEvent | null {
  const lifecycleEvents = events
    .filter(
      (e) =>
        isTicketSourceEvent(e) &&
        TICKET_LIFECYCLE_EVENT_TYPES.has(e.type) &&
        e.occurredAt <= asOf,
    )
    .sort(compareNormalizedEvents);

  let closure: NormalizedEvent | null = null;
  for (const event of lifecycleEvents) {
    if (event.type !== "case_closed") closure = null;
    else closure ??= event;
  }
  return closure;
}

/**
 * The event that completed a first-response commitment as of `asOf`: the
 * first ticket-source `agent_replied`, or the first ticket-source
 * `case_closed` when the case was closed before any agent replied —
 * whichever came first. Null while neither has happened.
 *
 * A same-instant "reply and close" (an agent reply and a close from the same
 * source event) resolves to the reply, not the close, even though the
 * source's own event order emits the transition first
 * (`compareNormalizedEvents`) — same tie-break `deriveNextReplyCycles` uses
 * for the identical situation, and for the identical reason: the reply is
 * the one that actually happened.
 *
 * `evaluateCommitment` reads `completionEvent.type` to tell the two apart
 * (D5): a reply-less close never reports `met` regardless of how much of the
 * target's time remained — a promised response that never happened is a
 * broken promise, not a satisfied one — while still finalizing the
 * commitment (closing it out) rather than leaving it evaluating forever
 * against a case nothing more will ever happen on.
 *
 * Unlike a resolution, a first response happens once: a case reopened after
 * the reply (or after a reply-less close) never reopens its first-response
 * commitment, so this deliberately ignores later reopens rather than using
 * `findCaseCloseEvent`'s current-closure rule.
 *
 * `startedAt`, when given, excludes anything before it (D5b): for an
 * agent-created ticket whose commitment clock starts at the first customer
 * reply, an agent reply that happened *before* that customer ever wrote
 * anything wasn't answering a request that existed yet, so it must never be
 * read as completing the commitment — `evaluateCommitment` passes
 * `commitment.startedAt` for exactly this reason. Callers deriving Next
 * Reply cycles (`findNextReplyCompletionEvent`, `runNextReplyCyclePipeline`)
 * omit it deliberately: cycle derivation needs the ticket's actual first
 * reply, regardless of which commitment window it falls in.
 */
export function findFirstResponseEvent(
  events: NormalizedEvent[],
  asOf: string,
  startedAt?: string,
): NormalizedEvent | null {
  let first: NormalizedEvent | null = null;
  for (const event of events) {
    if (!isTicketSourceEvent(event)) continue;
    if (event.type !== "agent_replied" && event.type !== "case_closed") continue;
    if (event.occurredAt > asOf) continue;
    if (startedAt !== undefined && event.occurredAt < startedAt) continue;
    if (!first || orderPreferringReply(event, first) < 0) first = event;
  }
  return first;
}

/**
 * `compareNormalizedEvents`, except a same-instant `agent_replied` sorts
 * before a `case_closed` — see `findFirstResponseEvent`'s "reply and close"
 * note. Same rule as `orderForCycleFold` in reply-cycles.ts, kept separate
 * since the two live in different modules and neither depends on the other.
 */
function orderPreferringReply(a: NormalizedEvent, b: NormalizedEvent): number {
  if (Date.parse(a.occurredAt) === Date.parse(b.occurredAt)) {
    if (a.type === "agent_replied" && b.type === "case_closed") return -1;
    if (a.type === "case_closed" && b.type === "agent_replied") return 1;
  }
  return compareNormalizedEvents(a, b);
}

/**
 * When a first-response commitment's clock should start (D5b): ticket
 * creation, unless the ticket itself was agent-created, in which case the
 * clock starts at the first ticket-source `customer_replied` — a customer
 * hasn't asked for anything yet, so the promise of a response can't start
 * running against them before they've said a word.
 *
 * Returns `null` when the ticket was agent-created and no customer has
 * replied yet: the caller must not create the commitment this run: there is
 * nothing to start its clock on. A later run, once the customer replies,
 * creates it.
 *
 * `events` should be the case's full event history; `caseCreatedAt` is the
 * fallback used when no `case_created` event is found at all (older rows
 * normalized before the event existed).
 */
export function resolveFirstResponseStartedAt(
  events: NormalizedEvent[],
  caseCreatedAt: string,
): string | null {
  const created = events
    .filter((e) => isTicketSourceEvent(e) && e.type === "case_created")
    .sort(compareNormalizedEvents)[0];
  if (!created || created.actor !== "agent") return caseCreatedAt;

  const firstCustomerReply = events
    .filter(
      (e) =>
        isTicketSourceEvent(e) &&
        e.type === "customer_replied" &&
        compareNormalizedEvents(e, created) >= 0,
    )
    .sort(compareNormalizedEvents)[0];
  return firstCustomerReply?.occurredAt ?? null;
}

/**
 * The event that completed a Next Reply commitment as of `asOf`: the agent
 * reply that answers the derived cycle matching `cycleKey`
 * (`deriveNextReplyCycles` — the single source of truth for Next Reply
 * cycles, never re-derived here), or null while that cycle is still open.
 *
 * Also null, rather than throwing, when `cycleKey` isn't among the cycles
 * currently derived from `events`: a stale commitment whose anchor reply was
 * removed on renormalization is reconciled/cancelled separately by the cycle
 * pipeline (`persistNextReplyCommitments`), not by the evaluator.
 *
 * `deriveNextReplyCycles` returns `EvaluationEventRef`s, so the matching
 * `NormalizedEvent` is looked back up in `events` by its stable identity
 * (system, source RawEvent, type, instant) — the same identity
 * `nextReplyCycleKey` uses.
 */
function findNextReplyCompletionEvent(
  events: NormalizedEvent[],
  asOf: string,
  cycleKey: string,
): NormalizedEvent | null {
  const firstResponseCompletion = findFirstResponseEvent(events, asOf);
  const cycles = deriveNextReplyCycles(events, { asOf, firstResponseCompletion });
  const cycle = cycles.find((c) => c.key === cycleKey);
  if (!cycle || !cycle.completion) return null;

  const { completion } = cycle;
  return (
    events.find(
      (e) =>
        e.sourceRawEventId === completion.sourceRawEventId &&
        e.system === completion.system &&
        e.type === completion.type &&
        e.occurredAt === completion.occurredAt,
    ) ?? null
  );
}

/**
 * The event that completed a commitment of `kind` as of `asOf`, or null
 * while it is still open: the first agent reply for `first_response`
 * (`findFirstResponseEvent`), the case's current close for `resolution`
 * (`findCaseCloseEvent`), the answering agent reply on its own cycle for
 * `next_reply` (`findNextReplyCompletionEvent` — requires `cycleKey`). Kinds
 * also differ in what pauses their clock (`pauseStatesFor`); all three share
 * the same elapsed-time fold.
 *
 * `startedAt` bounds `first_response` only (D5b — see `findFirstResponseEvent`):
 * an agent reply from before the commitment's own clock started (an
 * agent-created ticket's clock starts at the first customer reply, not
 * ticket creation) never counts as completing it.
 */
export function findCompletionEvent(
  kind: CommitmentKind,
  events: NormalizedEvent[],
  asOf: string,
  cycleKey?: string,
  startedAt?: string,
): NormalizedEvent | null {
  switch (kind) {
    case "first_response":
      return findFirstResponseEvent(events, asOf, startedAt);
    case "resolution":
      return findCaseCloseEvent(events, asOf);
    case "next_reply":
      if (cycleKey === undefined) {
        throw new Error("next_reply commitments require a cycleKey to find their completion event");
      }
      return findNextReplyCompletionEvent(events, asOf, cycleKey);
  }
}

/**
 * Where a commitment's SLA clock stops as of `asOf`: the completion instant
 * if the commitment is complete (`findCompletionEvent`), otherwise `asOf`
 * itself. The single cutoff rule `evaluateCommitment` and
 * `computeBreachedAt` both use, so the status and the breach instant can
 * never disagree about when the clock stopped.
 */
export function resolveClockCutoff(
  kind: CommitmentKind,
  events: NormalizedEvent[],
  asOf: string,
  cycleKey?: string,
  startedAt?: string,
): { completionEvent: NormalizedEvent | null; cutoff: string } {
  const completionEvent = findCompletionEvent(kind, events, asOf, cycleKey, startedAt);
  const cutoff =
    completionEvent && completionEvent.occurredAt < asOf ? completionEvent.occurredAt : asOf;
  return { completionEvent, cutoff };
}

/**
 * Evaluates a Commitment's current status as of `asOf`.
 *
 * Pure and deterministic (Phase 13.8): the same
 * `(commitment, events, policyVersion, calendar, asOf)` always produces an
 * identical `Evaluation`, id included. A breach is not a separate concept —
 * it is simply an Evaluation whose status is `"breached"`.
 *
 * Status transitions: `on_track → at_risk → met | breached`, driven by
 * `policyVersion.warnAtPercent` thresholds and, once the commitment's
 * completion event is observed (`findCompletionEvent` — the first agent
 * reply for first response, the case close for resolution, the answering
 * agent reply on `commitment.cycleKey`'s own cycle for next_reply), by
 * whether it happened inside or past the target.
 *
 * The clock is measured over the commitment's own window: from
 * `commitment.startedAt` to the cutoff (`resolveClockCutoff`). Earlier case
 * events never add elapsed time, but still decide whether the clock opens
 * paused (`foldClockIntervals`). For next_reply this window is clipped to
 * the cycle's own completion, exactly like the other kinds — there's no
 * separate elapsed-time rule for it.
 */
export function evaluateCommitment(
  commitment: Commitment,
  events: NormalizedEvent[],
  policyVersion: SLAPolicyVersion,
  calendar: BusinessCalendarVersion,
  asOf: string,
): Evaluation {
  const caseEvents = events
    .filter((e) => e.caseId === commitment.caseId)
    .sort(compareNormalizedEvents);

  const { completionEvent, cutoff: effectiveAsOf } = resolveClockCutoff(
    commitment.kind,
    caseEvents,
    asOf,
    commitment.cycleKey,
    commitment.startedAt,
  );

  const eventsUpToCutoff = caseEvents.filter(
    (e) => e.occurredAt <= effectiveAsOf,
  );
  const lastEvent =
    eventsUpToCutoff.length > 0
      ? eventsUpToCutoff[eventsUpToCutoff.length - 1]!
      : null;

  const fold = foldClockIntervals(
    eventsForPauseFold(commitment.kind, caseEvents),
    pauseStatesFor(commitment.kind, policyVersion),
    { start: commitment.startedAt, end: effectiveAsOf },
  );
  const elapsedWorkingMinutes = sumRunningWorkingMinutes(
    fold.runningIntervals,
    calendar,
  );
  const remainingMinutes = commitment.targetMinutes - elapsedWorkingMinutes;

  // D5: a first-response commitment completed by a reply-less close is
  // never "met" — a promised response that never came is a broken promise
  // regardless of how much target time was left when the case closed.
  const isReplylessClose =
    commitment.kind === "first_response" && completionEvent?.type === "case_closed";

  let status: CommitmentStatus;
  let warnThresholdCrossed: number | undefined;
  if (completionEvent) {
    status = !isReplylessClose && remainingMinutes >= 0 ? "met" : "breached";
    if (status === "breached") warnThresholdCrossed = BREACH_NOTIFICATION_THRESHOLD;
  } else if (remainingMinutes <= 0) {
    status = "breached";
    warnThresholdCrossed = BREACH_NOTIFICATION_THRESHOLD;
  } else {
    const percentConsumed =
      (elapsedWorkingMinutes / commitment.targetMinutes) * 100;
    const highestCrossedThreshold = [...policyVersion.warnAtPercent]
      .sort((a, b) => b - a)
      .find((threshold) => percentConsumed >= threshold);
    status = highestCrossedThreshold !== undefined ? "at_risk" : "on_track";
    warnThresholdCrossed = highestCrossedThreshold;
  }

  const clockState: ClockState = completionEvent
    ? "stopped"
    : fold.currentPause
      ? "paused"
      : "running";

  let effectiveDueAt: string | null = null;
  if (status === "breached") {
    effectiveDueAt = targetCrossingInstant(
      fold.runningIntervals,
      commitment.targetMinutes,
      calendar,
    );
  } else if (clockState === "running") {
    effectiveDueAt = projectDeadline(effectiveAsOf, remainingMinutes, calendar);
  }

  const elapsedSeconds = toWholeSeconds(elapsedWorkingMinutes);
  const remainingSeconds = commitment.targetMinutes * 60 - elapsedSeconds;

  const inputs = {
    lastEvent: lastEvent ? toEventRef(lastEvent) : null,
    policyVersionId: policyVersion.id,
    calendarVersionId: calendar.id,
  };

  const lastEventKey = inputs.lastEvent
    ? `${inputs.lastEvent.sourceRawEventId}:${inputs.lastEvent.type}:${inputs.lastEvent.occurredAt}:${inputs.lastEvent.toState}`
    : null;
  const id = stableHash(
    `${commitment.id}|${lastEventKey}|${inputs.policyVersionId}|${inputs.calendarVersionId}|${asOf}`,
  );

  return {
    id,
    commitmentId: commitment.id,
    evaluatedAt: asOf,
    elapsedWorkingMinutes,
    remainingMinutes,
    status,
    breachedByMinutes: remainingMinutes < 0 ? -remainingMinutes : undefined,
    elapsedSeconds,
    remainingSeconds,
    breachedBySeconds: remainingSeconds < 0 ? -remainingSeconds : undefined,
    clock: {
      state: clockState,
      pausedSince: clockState === "paused" ? fold.currentPause!.since : null,
      pauseCause: clockState === "paused" ? fold.currentPause!.cause : null,
    },
    effectiveDueAt,
    warnThresholdCrossed,
    inputs,
  };
}

/**
 * Whole seconds in a working-minute count, rounded down. Event timestamps
 * are millisecond-precise, so the tolerance only absorbs floating-point
 * drift from summing minute fractions (e.g. 33.99999999997 → 34), never a
 * real fraction of a second.
 */
function toWholeSeconds(minutes: number): number {
  return Math.floor(minutes * 60 + 1e-6);
}

function toEventRef(event: NormalizedEvent): EvaluationEventRef {
  return {
    sourceRawEventId: event.sourceRawEventId,
    system: event.system,
    type: event.type,
    occurredAt: event.occurredAt,
    toState: event.toState,
  };
}

/**
 * The deadline if the clock keeps running from `from`. Null when the calendar
 * has no working time within `computeDeadline`'s search horizon — a
 * misconfigured calendar must not make the evaluation itself fail, since
 * elapsed time and status never depended on it.
 */
function projectDeadline(
  from: string,
  remainingMinutes: number,
  calendar: BusinessCalendarVersion,
): string | null {
  try {
    return computeDeadline(from, remainingMinutes, calendar).toISOString();
  } catch {
    return null;
  }
}

/**
 * The instant the running clock first accumulated `targetMinutes` working
 * minutes across `runningIntervals`.
 */
function targetCrossingInstant(
  runningIntervals: { start: Date; end: Date }[],
  targetMinutes: number,
  calendar: BusinessCalendarVersion,
): string | null {
  let remaining = targetMinutes;
  for (const interval of runningIntervals) {
    const available = workingMinutesBetween(interval.start, interval.end, calendar);
    if (available >= remaining) {
      return computeDeadline(interval.start, remaining, calendar).toISOString();
    }
    remaining -= available;
  }

  // Only reachable through floating-point drift when elapsed lands exactly
  // on the target at the cutoff: the crossing is the end of the last
  // running interval.
  const last = runningIntervals[runningIntervals.length - 1];
  return last ? last.end.toISOString() : null;
}

/**
 * The instant a commitment actually breached: the moment its running SLA
 * clock (working minutes per `calendar` since `commitment.startedAt`,
 * excluding the commitment's own pauses, `pauseStatesFor`)
 * first reached `targetMinutes`. `null` unless `evaluateCommitment` reports
 * the commitment `breached` as of `asOf` — a met, on-track or at-risk
 * commitment has no breach instant.
 *
 * Derived from events, never stored ("store events, never store computed
 * time"), and independent of when it was evaluated: a later `asOf` (the
 * next poll, a reconciliation sweep days later) returns the same instant,
 * because the clock's running intervals before the crossing don't change.
 * Only new or corrected events before that instant can move it, which is
 * the point. `Commitment.dueAt` isn't this: it's frozen at creation and
 * ignores pauses.
 *
 * Consistent with `evaluateCommitment`'s own boundary: an open commitment
 * is breached once elapsed reaches the target, so the crossing can be the
 * `asOf` instant itself; a completed one only once it strictly exceeds the
 * target before completing, so the crossing is always before completion.
 */
export function computeBreachedAt(
  commitment: Commitment,
  events: NormalizedEvent[],
  policyVersion: SLAPolicyVersion,
  calendar: BusinessCalendarVersion,
  asOf: string,
): string | null {
  const evaluation = evaluateCommitment(commitment, events, policyVersion, calendar, asOf);
  return evaluation.status === "breached" ? evaluation.effectiveDueAt : null;
}
