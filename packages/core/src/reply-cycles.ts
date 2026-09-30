import { compareNormalizedEvents } from "./ordering";
import { isTicketSourceEvent } from "./ticket-source";
import type { EvaluationEventRef, NextReplyCycle, NormalizedEvent } from "./types";

export interface DeriveNextReplyCyclesOptions {
  /** Events after this instant are ignored. */
  asOf: string;
  /**
   * The event that completed the case's first response
   * (`findFirstResponseEvent`). Customer replies sorting before it
   * (`compareNormalizedEvents`) are covered by first response and never
   * start or join a Next Reply cycle.
   *
   * - `undefined`: no gating — every customer reply counts.
   * - `null`: first response isn't complete yet, so no customer reply counts.
   */
  firstResponseCompletion?: NormalizedEvent | null;
}

/**
 * A cycle's stable identity: the anchor customer reply's system, source
 * RawEvent, type and instant. NormalizedEvent ids are regenerated on every
 * normalization run and `sourceSequence` shifts when an earlier audit is
 * ingested late, so neither is used. Unique per case because a source
 * RawEvent (a Zendesk audit, an Intercom part) carries at most one reply
 * that can anchor a cycle.
 */
export function nextReplyCycleKey(anchor: EvaluationEventRef): string {
  return `next_reply:${anchor.system}:${anchor.sourceRawEventId}:${anchor.type}:${new Date(anchor.occurredAt).toISOString()}`;
}

/**
 * Derives a case's Next Reply cycles as of `asOf` from its normalized events.
 *
 * Folds the ticket-source events in the one deterministic event order
 * (`compareNormalizedEvents`):
 *
 * - a `customer_replied` with no cycle open starts one, anchored at it;
 *   further customer replies join the open cycle;
 * - the next `agent_replied` answers every customer reply in the open cycle
 *   and completes it; an agent reply with no cycle open does nothing, so
 *   consecutive agent replies never create cycles;
 * - a `case_closed` while a cycle is open (D4) drops it — it is cancelled,
 *   not completed: it never appears in the returned cycles at all, which is
 *   what lets the persistence layer's own "derived key disappeared" rule
 *   (`planCycleCommitments`) cancel any commitment already created for it,
 *   with no separate cancellation path needed here. A reopen carries no
 *   event of its own in this fold — it falls out for free, since the next
 *   `customer_replied` after the close finds no cycle open and starts a
 *   fresh one.
 * - a same-instant "reply and close" (an agent reply and a close from the
 *   same source event — Intercom's `close` part type with a body, or a
 *   Zendesk macro that solves with a public comment) answers the cycle
 *   before the close is considered, even though the source's own event
 *   order emits the transition first (`compareNormalizedEvents`): the reply
 *   is the answer, and the paired close must not instead cancel it.
 * - every other event — state changes (including `pending_customer`, since
 *   Next Reply never pauses), linked-issue activity — is ignored.
 *
 * Private notes and bot/automation messages never reach this function as
 * reply events; the normalizers don't emit them.
 *
 * Takes one case's events. Pure and deterministic: input order doesn't
 * matter, and the same `(events, options)` always yields the same cycles.
 */
export function deriveNextReplyCycles(
  events: readonly NormalizedEvent[],
  options: DeriveNextReplyCyclesOptions,
): NextReplyCycle[] {
  const asOfMs = Date.parse(options.asOf);
  if (Number.isNaN(asOfMs)) throw new RangeError(`Invalid asOf: ${options.asOf}`);
  const { firstResponseCompletion } = options;

  const replies = events
    .filter(
      (e) =>
        (e.type === "customer_replied" || e.type === "agent_replied" || e.type === "case_closed") &&
        isTicketSourceEvent(e) &&
        Date.parse(e.occurredAt) <= asOfMs,
    )
    .sort(orderForCycleFold);

  const cycles: NextReplyCycle[] = [];
  let open: NextReplyCycle | null = null;

  for (const event of replies) {
    if (event.type === "customer_replied") {
      if (firstResponseCompletion === null) continue;
      if (firstResponseCompletion && compareNormalizedEvents(event, firstResponseCompletion) < 0) continue;

      const ref = toEventRef(event);
      if (open) {
        open.customerReplies.push(ref);
      } else {
        open = {
          key: nextReplyCycleKey(ref),
          index: cycles.length,
          startedAt: toIso(event.occurredAt),
          anchor: ref,
          customerReplies: [ref],
          completedAt: null,
          completion: null,
          completionType: null,
        };
      }
      continue;
    }

    if (event.type === "case_closed") {
      open = null;
      continue;
    }

    if (!open) continue;
    open.completedAt = toIso(event.occurredAt);
    open.completion = toEventRef(event);
    open.completionType = "agent_replied";
    cycles.push(open);
    open = null;
  }

  if (open) cycles.push(open);
  return cycles;
}

/**
 * `compareNormalizedEvents`, except a same-instant `agent_replied` sorts
 * before a `case_closed` — the opposite of the source's own event order
 * (which emits a "reply and close" part's transition first). Only this
 * fold needs the flip: the reply must answer the cycle before the paired
 * close is considered, or a reply-and-close would cancel the very cycle it
 * just answered instead of completing it.
 */
function orderForCycleFold(a: NormalizedEvent, b: NormalizedEvent): number {
  if (Date.parse(a.occurredAt) === Date.parse(b.occurredAt)) {
    if (a.type === "agent_replied" && b.type === "case_closed") return -1;
    if (a.type === "case_closed" && b.type === "agent_replied") return 1;
  }
  return compareNormalizedEvents(a, b);
}

function toIso(timestamp: string): string {
  return new Date(timestamp).toISOString();
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
