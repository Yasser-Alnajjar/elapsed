import { sortNormalizedEvents } from "./ordering";
import { isTicketSourceEvent } from "./ticket-source";
import type {
  Confidence,
  Leg,
  LegDerivationResult,
  LegDerivationWarning,
  LegSpan,
  NormalizedEvent,
  NormalizedState,
} from "./types";

export interface DeriveLegSpansOptions {
  /**
   * When the case's own open time predates the first known event, pass it
   * here so the leading span is bounded rather than treated as a directly
   * observed boundary (the "missing handoff event" hard case — bound by
   * the surrounding known events and mark it inferred).
   */
  caseOpenedAt?: string;
}

interface Decision {
  leg: Leg;
  confidence: Confidence;
  note?: string;
}

/**
 * Derives the OLA ownership timeline from normalized events, per the
 * two-leg-plus-waiting-customer model (Architecture Sketch Phase 14).
 *
 * Ownership is *observable*, not configured: `waiting_customer` when the
 * helpdesk state indicates the customer owes a response, `engineering`
 * when a linked issue is active and non-terminal, `support` otherwise, and
 * `unknown` when signals are contradictory or absent — never guessed.
 *
 * Pure and deterministic: the same event list always produces the same
 * spans and warnings.
 */
export function deriveLegSpans(
  events: NormalizedEvent[],
  options: DeriveLegSpansOptions = {},
): LegDerivationResult {
  const warnings: LegDerivationWarning[] = [];
  const spans: LegSpan[] = [];
  if (events.length === 0) return { spans, warnings };

  const sorted = sortNormalizedEvents(events);

  // Events whose `sourceRole` is `ticket_source` drive the same decision — a
  // case only ever comes from one ticket source, so whichever one is present
  // is "the" helpdesk state.
  let ticketSourceState: NormalizedState | null = null;
  // Every other role (`work_tracker` and `code_host`) drives the engineering
  // state — a case's engineering leg ends when its linked issue resolves,
  // regardless of which tracker or code host it lives in.
  let engineeringState: NormalizedState | null = null;
  let linkedIssueCount = 0;

  const decide = (): Decision => {
    if (ticketSourceState === "pending_customer") {
      return { leg: "waiting_customer", confidence: "certain" };
    }
    if (linkedIssueCount > 0) {
      if (engineeringState === "resolved" || engineeringState === "closed") {
        return { leg: "support", confidence: "certain" };
      }
      return linkedIssueCount > 1
        ? {
            leg: "engineering",
            confidence: "certain",
            note: `${linkedIssueCount} linked issues — attributed as one engineering leg`,
          }
        : { leg: "engineering", confidence: "certain" };
    }
    if (ticketSourceState === null) {
      return { leg: "unknown", confidence: "unknown", note: "no signal yet" };
    }
    return { leg: "support", confidence: "certain" };
  };

  const firstEventAt = sorted[0]!.occurredAt;
  const backfillGap =
    options.caseOpenedAt !== undefined && options.caseOpenedAt < firstEventAt;
  let spanStart = backfillGap ? options.caseOpenedAt! : firstEventAt;

  let currentLeg: Leg | null = null;
  let currentConfidence: Confidence = "unknown";
  let currentNote: string | undefined;

  // Only the very first decision (made while currentLeg is still null) can be
  // downgraded by a backfill gap — every later transition is bounded by an
  // observed event on both sides.
  const applyBackfillDowngrade = (decision: Decision): Decision => {
    if (!backfillGap) return decision;
    if (decision.confidence === "unknown") return decision;
    const note = decision.note
      ? `${decision.note}; handoff not observed, bounded by case open`
      : "handoff not observed, bounded by case open";
    return { leg: decision.leg, confidence: "inferred", note };
  };

  const flush = (endedAt: string | null) => {
    if (currentLeg === null) return;
    spans.push({
      leg: currentLeg,
      confidence: currentConfidence,
      startedAt: spanStart,
      endedAt,
      note: currentNote,
    });
  };

  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1]!.occurredAt === sorted[i]!.occurredAt
    )
      j++;
    const batch = sorted.slice(i, j + 1);
    const at = sorted[i]!.occurredAt;

    const hasLink = batch.some((e) => e.type === "issue_linked");
    const hasUnlink = batch.some((e) => e.type === "issue_unlinked");
    const ambiguousBatch = hasLink && hasUnlink;

    for (const event of batch) {
      if (
        (event.type === "state_changed" || event.type === "case_created") &&
        event.toState
      ) {
        // Filtered to state-bearing types above, so this is always a real
        // NormalizedState, never a priority_changed value.
        const toState = event.toState as NormalizedState;
        if (isTicketSourceEvent(event)) ticketSourceState = toState;
        else engineeringState = toState;
      }
      if (event.type === "issue_linked") linkedIssueCount++;
      if (event.type === "issue_unlinked")
        linkedIssueCount = Math.max(0, linkedIssueCount - 1);
    }

    let next: Decision;
    if (ambiguousBatch) {
      warnings.push({
        kind: "ambiguous_handoff",
        message:
          "Contemporaneous link and unlink events — handoff direction is unresolvable",
        at,
      });
      next = {
        leg: "unknown",
        confidence: "unknown",
        note: "ambiguous handoff",
      };
    } else {
      const decision = decide();
      next = currentLeg === null ? applyBackfillDowngrade(decision) : decision;
    }

    // A note-only change (e.g. a second linked issue updating the count) is
    // an annotation refresh, not an ownership change — it must not split the
    // span. Only leg/confidence transitions are boundaries.
    const changed =
      currentLeg === null ||
      next.leg !== currentLeg ||
      next.confidence !== currentConfidence;

    if (changed) {
      if (currentLeg !== null) {
        flush(at);
        spanStart = at;
      }
      currentLeg = next.leg;
    }
    currentConfidence = next.confidence;
    currentNote = next.note;

    i = j + 1;
  }

  flush(null);
  warnings.push(...validateLegSpans(spans));
  return { spans, warnings };
}

/**
 * Sums wall-clock minutes spent in `leg` across every one of its spans for a
 * case — closed spans and, if still open, the current one bounded by `asOf`.
 * Cumulative rather than "current span only" (roadmap step 16): a case that
 * bounced in and out of engineering should have the whole engineering time
 * count against its leg target, not just the most recent stretch.
 */
export function sumLegMinutes(spans: LegSpan[], leg: Leg, asOf: string): number {
  const asOfMs = new Date(asOf).getTime();
  return spans
    .filter((span) => span.leg === leg)
    .reduce((sum, span) => {
      const start = new Date(span.startedAt).getTime();
      const end = span.endedAt ? new Date(span.endedAt).getTime() : asOfMs;
      return sum + Math.max(0, Math.round((end - start) / 60000));
    }, 0);
}

/**
 * The leg that owned the case at a specific instant — e.g. "which leg was
 * this in when it breached", as opposed to `sumLegMinutes`'s cumulative
 * question. `unknown` when `at` falls outside every span (before the first
 * or after the last, which for a still-open case never happens for
 * `endedAt: null`).
 */
export function legAtTime(spans: LegSpan[], at: string): Leg {
  const atMs = new Date(at).getTime();
  for (const span of spans) {
    const startMs = new Date(span.startedAt).getTime();
    const endMs = span.endedAt ? new Date(span.endedAt).getTime() : Infinity;
    if (atMs >= startMs && atMs < endMs) return span.leg;
  }
  return "unknown";
}

/**
 * Checks a list of leg spans for structural impossibilities — negative
 * duration or overlap with the next span. These arise from human
 * configuration error (e.g. a manually corrected span) rather than from
 * `deriveLegSpans` itself, which produces a strictly ordered timeline by
 * construction. Surfaced as a data-quality warning, never silently
 * normalized (Phase 14's hard-cases table).
 */
export function validateLegSpans(spans: LegSpan[]): LegDerivationWarning[] {
  const warnings: LegDerivationWarning[] = [];

  for (const span of spans) {
    if (span.endedAt !== null && span.endedAt < span.startedAt) {
      warnings.push({
        kind: "impossible_span",
        message: `Span starting ${span.startedAt} ends at ${span.endedAt}, before it started`,
        at: span.endedAt,
      });
    }
  }

  for (let i = 0; i + 1 < spans.length; i++) {
    const current = spans[i]!;
    const next = spans[i + 1]!;
    if (current.endedAt !== null && current.endedAt > next.startedAt) {
      warnings.push({
        kind: "impossible_span",
        message: `Span ending ${current.endedAt} overlaps the next span starting ${next.startedAt}`,
        at: next.startedAt,
      });
    }
  }

  return warnings;
}
