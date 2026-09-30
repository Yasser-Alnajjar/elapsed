import { withSourceRole } from "./source-role";
import { describe, expect, it } from "vitest";
import { BREACH_NOTIFICATION_THRESHOLD, evaluateCommitment, findCompletionEvent } from "../src/evaluate";
import { nextReplyCycleKey } from "../src/reply-cycles";
import type {
  BusinessCalendarVersion,
  Commitment,
  EvaluationEventRef,
  NormalizedEvent,
  NormalizedEventType,
  SLAPolicyVersion,
} from "../src/types";

/**
 * Next Reply commitment evaluation: `evaluateCommitment` matches a persisted
 * commitment to its derived cycle by `cycleKey` (`deriveNextReplyCycles` is
 * the single source of truth — never re-derived here), and reuses the
 * generic clock/window/calendar machinery every other kind uses.
 */

const at = (time: string) => `2026-09-17T${time}:00.000Z`;

const alwaysOpen: BusinessCalendarVersion = {
  id: "cal-24-7",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};

// pauseOnStates is deliberately non-empty, to prove next_reply ignores it
// (clock-rules.ts: next_reply never pauses) rather than this policy simply
// having nothing to pause on.
const policy: SLAPolicyVersion = {
  id: "policy-next-reply",
  policyId: "policy",
  version: 1,
  match: {},
  targets: [{ kind: "next_reply", minutes: 60 }],
  pauseOnStates: ["pending_customer"],
  calendarVersionId: alwaysOpen.id,
  warnAtPercent: [50, 80, 95],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

let seq = 0;
function event(
  time: string,
  type: NormalizedEventType,
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  seq += 1;
  return withSourceRole({
    id: `evt-${seq}`,
    caseId: "case-1",
    type,
    occurredAt: at(time),
    actor: type === "customer_replied" ? "customer" : "agent",
    system: "zendesk",
    fromState: null,
    toState: null,
    sourceRawEventId: `raw-${seq}`,
    ...overrides,
  });
}

const created = () => event("08:00", "case_created", { toState: "open", actor: "customer" });
const firstReply = () => event("08:30", "agent_replied");
const customer = (time: string, overrides: Partial<NormalizedEvent> = {}) =>
  event(time, "customer_replied", overrides);
const agent = (time: string, overrides: Partial<NormalizedEvent> = {}) => event(time, "agent_replied", overrides);

function refOf(e: NormalizedEvent): EvaluationEventRef {
  return { sourceRawEventId: e.sourceRawEventId, system: e.system, type: e.type, occurredAt: e.occurredAt, toState: e.toState };
}

function nextReplyCommitment(anchor: NormalizedEvent, overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: `commitment-${anchor.sourceRawEventId}`,
    caseId: "case-1",
    kind: "next_reply",
    cycleKey: nextReplyCycleKey(refOf(anchor)),
    policyVersionId: policy.id,
    calendarVersionId: alwaysOpen.id,
    startedAt: anchor.occurredAt,
    targetMinutes: 60,
    dueAt: new Date(new Date(anchor.occurredAt).getTime() + 60 * 60_000).toISOString(),
    status: "on_track",
    ...overrides,
  };
}

describe("evaluateCommitment for next_reply", () => {
  it("resolves to met when the agent replies inside the target", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1, agent("09:30")];
    const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("10:00"));
    expect(evaluation.status).toBe("met");
    expect(evaluation.elapsedWorkingMinutes).toBe(30);
    expect(evaluation.clock.state).toBe("stopped");
  });

  it("resolves to breached, and stops the clock, when the agent replies past the target", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1, agent("10:30")];
    const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("11:00"));
    expect(evaluation.status).toBe("breached");
    expect(evaluation.breachedByMinutes).toBe(30);
    expect(evaluation.clock.state).toBe("stopped");
    expect(evaluation.warnThresholdCrossed).toBe(BREACH_NOTIFICATION_THRESHOLD);
  });

  it("stays on_track, then at_risk, while the deadline hasn't passed and no agent reply yet", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1];
    const onTrack = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("09:20"));
    expect(onTrack.status).toBe("on_track");
    expect(onTrack.clock.state).toBe("running");

    // 50/60 = 83.3%, crosses the 80% threshold but isn't breached yet.
    const atRisk = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("09:50"));
    expect(atRisk.status).toBe("at_risk");
    expect(atRisk.warnThresholdCrossed).toBe(80);
  });

  it("is breached but stays active (non-terminal clock) once the deadline passes with no agent reply", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1];
    const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("10:15"));
    expect(evaluation.status).toBe("breached");
    expect(evaluation.clock.state).toBe("running");
    expect(evaluation.breachedByMinutes).toBe(15);
  });

  it("starts the clock at the oldest unanswered customer reply when several are answered by one agent reply", () => {
    const c1 = customer("09:00");
    const c2 = customer("09:10");
    const events = [created(), firstReply(), c1, c2, agent("09:30")];
    const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("10:00"));
    expect(evaluation.status).toBe("met");
    expect(evaluation.elapsedWorkingMinutes).toBe(30);
  });

  it("is unaffected by extra agent replies after the cycle already completed (consecutive agent replies are no-op)", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1, agent("09:20"), agent("09:40"), agent("10:00")];
    const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("10:30"));
    expect(evaluation.status).toBe("met");
    expect(evaluation.elapsedWorkingMinutes).toBe(20);
    expect(evaluation.inputs.lastEvent?.occurredAt).toBe(at("09:20"));
  });

  it("evaluates two cycles on the same case independently", () => {
    const c1 = customer("09:00");
    const c2 = customer("09:40");
    const events = [created(), firstReply(), c1, agent("09:20"), c2];

    const firstCycle = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("10:00"));
    expect(firstCycle.status).toBe("met");
    expect(firstCycle.clock.state).toBe("stopped");

    const secondCycle = evaluateCommitment(nextReplyCommitment(c2), events, policy, alwaysOpen, at("10:00"));
    expect(secondCycle.status).toBe("on_track");
    expect(secondCycle.clock.state).toBe("running");
    expect(secondCycle.elapsedWorkingMinutes).toBe(20);
  });

  it("keeps running through a pending_customer state change (Next Reply never pauses)", () => {
    const c1 = customer("09:00");
    const events = [
      created(),
      firstReply(),
      c1,
      event("09:10", "state_changed", { toState: "pending_customer" }),
      event("09:20", "state_changed", { toState: "open", actor: "customer" }),
      agent("10:00"),
    ];
    const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("10:30"));
    expect(evaluation.elapsedWorkingMinutes).toBe(60);
    expect(evaluation.status).toBe("met");
  });

  it("is not completed by a case_closed event", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1, event("09:15", "case_closed", { toState: "resolved" })];
    // 30 of 60 target minutes elapsed (case_closed doesn't stop the clock) — at the 50% warn threshold.
    const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("09:30"));
    expect(evaluation.clock.state).toBe("running");
    expect(evaluation.status).toBe("at_risk");
  });

  it("never completes a commitment keyed to a customer reply that first-response gating excluded", () => {
    const earlyReply = customer("08:10"); // before first response at 08:30
    const events = [created(), earlyReply, firstReply()];
    const commitment = nextReplyCommitment(earlyReply);
    const evaluation = evaluateCommitment(commitment, events, policy, alwaysOpen, at("09:00"));
    expect(evaluation.clock.state).toBe("running");
    expect(findCompletionEvent("next_reply", events, at("09:00"), commitment.cycleKey)).toBeNull();
  });

  describe("same-timestamp events respect deterministic ordering", () => {
    it("completes the cycle when the customer reply sorts before the agent reply", () => {
      const c1 = customer("09:00", { sourceSequence: 1 });
      const a1 = agent("09:00", { sourceSequence: 2 });
      const events = [created(), firstReply(), c1, a1];
      const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("09:30"));
      expect(evaluation.status).toBe("met");
      expect(evaluation.elapsedWorkingMinutes).toBe(0);
    });

    it("leaves the cycle open when the agent reply sorts first", () => {
      const a1 = agent("09:00", { sourceSequence: 1 });
      const c1 = customer("09:00", { sourceSequence: 2 });
      const events = [created(), firstReply(), a1, c1];
      // Still open at 09:30 — 30 of 60 target minutes elapsed, at the 50% warn threshold.
      const evaluation = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, at("09:30"));
      expect(evaluation.clock.state).toBe("running");
      expect(evaluation.status).toBe("at_risk");
    });
  });

  it("repeated evaluation at the same asOf is idempotent", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1, agent("09:45")];
    const asOf = at("10:00");
    const first = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, asOf);
    const second = evaluateCommitment(nextReplyCommitment(c1), events, policy, alwaysOpen, asOf);
    expect(first).toEqual(second);
  });

  it("returns null completion, rather than throwing, for a cycleKey that derives no cycle at all", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1, agent("09:30")];
    const orphan = nextReplyCommitment(c1, {
      cycleKey: "next_reply:zendesk:raw-does-not-exist:customer_replied:2026-09-17T00:00:00.000Z",
      startedAt: at("07:00"),
    });
    const evaluation = evaluateCommitment(orphan, events, policy, alwaysOpen, at("10:00"));
    expect(evaluation.clock.state).toBe("running");
    // Still accrues elapsed time over its own window — reconciliation, not the
    // evaluator, is what will cancel a commitment like this.
    expect(evaluation.elapsedWorkingMinutes).toBe(180);
    expect(findCompletionEvent("next_reply", events, at("10:00"), orphan.cycleKey)).toBeNull();
  });

  describe("calendar-aware elapsed time (business hours, Mon-Fri 09:00-17:00 UTC)", () => {
    const businessHours: BusinessCalendarVersion = {
      id: "cal-business-hours",
      version: 1,
      timezone: "UTC",
      weekly: [1, 2, 3, 4, 5].map((day) => ({ day: day as 1 | 2 | 3 | 4 | 5, openMinute: 9 * 60, closeMinute: 17 * 60 })),
      holidays: [],
      alwaysOpen: false,
    };

    // Friday 2026-09-18 16:30 UTC — 30 working minutes left before the
    // weekend; the remaining 30 minutes of the 60-minute target carry over to
    // Monday 2026-09-21 09:00.
    const fridayReply = (): NormalizedEvent => ({ ...customer("00:00"), occurredAt: "2026-09-18T16:30:00.000Z" });

    it("carries the remaining target minutes over the weekend and resolves met exactly at the boundary", () => {
      const c1 = fridayReply();
      const events = [created(), firstReply(), c1, { ...agent("00:00"), occurredAt: "2026-09-21T09:30:00.000Z" }];
      const evaluation = evaluateCommitment(
        nextReplyCommitment(c1),
        events,
        policy,
        businessHours,
        "2026-09-21T10:00:00.000Z",
      );
      expect(evaluation.elapsedWorkingMinutes).toBe(60);
      expect(evaluation.status).toBe("met");
      expect(evaluation.clock.state).toBe("stopped");
    });

    it("resolves breached once the reply lands past the calendar-adjusted deadline", () => {
      const c1 = fridayReply();
      const events = [created(), firstReply(), c1, { ...agent("00:00"), occurredAt: "2026-09-21T10:00:00.000Z" }];
      const evaluation = evaluateCommitment(
        nextReplyCommitment(c1),
        events,
        policy,
        businessHours,
        "2026-09-21T10:30:00.000Z",
      );
      expect(evaluation.elapsedWorkingMinutes).toBe(90);
      expect(evaluation.status).toBe("breached");
      expect(evaluation.breachedByMinutes).toBe(30);
      expect(evaluation.clock.state).toBe("stopped");
    });

    it("stays breached-but-active over the weekend gap with no agent reply yet", () => {
      const c1 = fridayReply();
      const events = [created(), firstReply(), c1];
      const evaluation = evaluateCommitment(
        nextReplyCommitment(c1),
        events,
        policy,
        businessHours,
        "2026-09-21T09:35:00.000Z",
      );
      // 30 min Friday + 35 min Monday morning = 65 elapsed working minutes.
      expect(evaluation.elapsedWorkingMinutes).toBe(65);
      expect(evaluation.status).toBe("breached");
      expect(evaluation.clock.state).toBe("running");
    });
  });
});

describe("findCompletionEvent for next_reply", () => {
  it("throws when called without a cycleKey", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1, agent("09:30")];
    expect(() => findCompletionEvent("next_reply", events, at("10:00"))).toThrow(/cycleKey/);
  });

  it("returns null for a cycleKey that isn't among the currently derived cycles", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1, agent("09:30")];
    expect(findCompletionEvent("next_reply", events, at("10:00"), "next_reply:zendesk:nope:customer_replied:x")).toBeNull();
  });

  it("returns the actual agent-reply event that answered the matched cycle", () => {
    const c1 = customer("09:00");
    const answer = agent("09:30");
    const events = [created(), firstReply(), c1, answer];
    const cycleKey = nextReplyCycleKey(refOf(c1));
    expect(findCompletionEvent("next_reply", events, at("10:00"), cycleKey)).toBe(answer);
  });

  it("returns null while the matched cycle is still open", () => {
    const c1 = customer("09:00");
    const events = [created(), firstReply(), c1];
    const cycleKey = nextReplyCycleKey(refOf(c1));
    expect(findCompletionEvent("next_reply", events, at("10:00"), cycleKey)).toBeNull();
  });
});
