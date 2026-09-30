import { withSourceRole } from "./source-role";
import { describe, expect, it } from "vitest";
import { computeBreachedAt, evaluateCommitment } from "../src/evaluate.js";
import type {
  BusinessCalendarVersion,
  Commitment,
  NormalizedEvent,
  SLAPolicyVersion,
} from "../src/types";

// Zendesk ticket #45's timeline (UTC+3 local): opened 12:19:30, 2-minute
// target, moved to Pending at 12:20:04, viewed at 12:23. The pause/resume
// clock mechanics are exercised on a resolution commitment, which pauses on
// Pending; the ticket's actual first-response commitment never pauses
// (clock-rules.ts) and is covered at the end of this file.
const OPENED = "2026-09-17T09:19:30.000Z";
const PAUSED = "2026-09-17T09:20:04.000Z";
const AS_OF = "2026-09-17T09:23:00.000Z";

const alwaysOpen: BusinessCalendarVersion = {
  id: "cal-24-7",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};

const policy: SLAPolicyVersion = {
  id: "policy-v6",
  policyId: "policy",
  version: 6,
  match: { priority: ["urgent"] },
  targets: [
    { kind: "first_response", minutes: 2 },
    { kind: "resolution", minutes: 2 },
  ],
  pauseOnStates: ["pending_customer"],
  calendarVersionId: alwaysOpen.id,
  warnAtPercent: [50, 80, 95],
  effectiveFrom: "2026-09-17T09:14:41.625Z",
};

const commitment: Commitment = {
  id: "commitment-45",
  caseId: "case-45",
  kind: "resolution",
  policyVersionId: policy.id,
  calendarVersionId: alwaysOpen.id,
  startedAt: OPENED,
  targetMinutes: 2,
  dueAt: "2026-09-17T09:21:30.000Z", // nominal: startedAt + target, ignores pauses
  status: "on_track",
};

function event(
  id: string,
  occurredAt: string,
  partial: Partial<NormalizedEvent>,
): NormalizedEvent {
  return withSourceRole({
    id,
    caseId: "case-45",
    type: "state_changed",
    occurredAt,
    actor: "agent",
    system: "zendesk",
    fromState: "open",
    toState: "open",
    sourceRawEventId: "raw-audit",
    ...partial,
  });
}

const created = event("evt-created", OPENED, {
  type: "case_created",
  fromState: null,
  toState: "open",
  actor: "customer",
  sourceRawEventId: "raw-audit",
});
const pending = event("evt-pending", PAUSED, {
  fromState: "open",
  toState: "pending_customer",
  sourceRawEventId: "raw-audit",
});

describe("SLA clock state (ticket #45 regression)", () => {
  it("Case A: a pause 34s in keeps the commitment on track, paused, with 86s left", () => {
    const evaluation = evaluateCommitment(commitment, [created, pending], policy, alwaysOpen, AS_OF);

    expect(evaluation.status).toBe("on_track");
    expect(evaluation.status).not.toBe("breached");
    expect(evaluation.elapsedSeconds).toBe(34);
    expect(evaluation.remainingSeconds).toBe(86);
    expect(evaluation.breachedBySeconds).toBeUndefined();
    expect(evaluation.clock).toEqual({
      state: "paused",
      pausedSince: PAUSED,
      pauseCause: "pending_customer",
    });
    // No deadline can be known while paused — and never the nominal dueAt.
    expect(evaluation.effectiveDueAt).toBeNull();
    expect(computeBreachedAt(commitment, [created, pending], policy, alwaysOpen, AS_OF)).toBeNull();
  });

  it("Case B: without the pause the same commitment is breached at the nominal deadline", () => {
    const evaluation = evaluateCommitment(commitment, [created], policy, alwaysOpen, AS_OF);

    expect(evaluation.status).toBe("breached");
    expect(evaluation.clock.state).toBe("running");
    expect(evaluation.elapsedSeconds).toBe(210);
    expect(evaluation.remainingSeconds).toBe(-90);
    expect(evaluation.breachedBySeconds).toBe(90);
    // With no pause, the effective deadline is exactly the nominal one.
    expect(evaluation.effectiveDueAt).toBe(commitment.dueAt);
  });

  it("Case C: after resuming, the remaining 86s count down from the resume point", () => {
    const RESUMED = "2026-09-17T09:30:00.000Z";
    const resumed = event("evt-resumed", RESUMED, {
      fromState: "pending_customer",
      toState: "open",
      actor: "customer",
    });
    const events = [created, pending, resumed];

    const atResume = evaluateCommitment(commitment, events, policy, alwaysOpen, RESUMED);
    expect(atResume.clock).toEqual({ state: "running", pausedSince: null, pauseCause: null });
    expect(atResume.remainingSeconds).toBe(86);
    expect(atResume.effectiveDueAt).toBe("2026-09-17T09:31:26.000Z");

    const midway = evaluateCommitment(commitment, events, policy, alwaysOpen, "2026-09-17T09:31:00.000Z");
    expect(midway).toMatchObject({ status: "at_risk", elapsedSeconds: 94, remainingSeconds: 26 });
    expect(midway.effectiveDueAt).toBe("2026-09-17T09:31:26.000Z");

    const justBefore = evaluateCommitment(commitment, events, policy, alwaysOpen, "2026-09-17T09:31:25.000Z");
    expect(justBefore.status).not.toBe("breached");
    expect(justBefore.remainingSeconds).toBe(1);

    const atDeadline = evaluateCommitment(commitment, events, policy, alwaysOpen, "2026-09-17T09:31:26.000Z");
    expect(atDeadline.status).toBe("breached");
    expect(atDeadline.remainingSeconds).toBe(0);

    const after = evaluateCommitment(commitment, events, policy, alwaysOpen, "2026-09-17T09:32:00.000Z");
    expect(after).toMatchObject({ status: "breached", remainingSeconds: -34, breachedBySeconds: 34 });
    // Once breached the deadline is a fixed past instant, whatever asOf is.
    expect(after.effectiveDueAt).toBe("2026-09-17T09:31:26.000Z");
    expect(computeBreachedAt(commitment, events, policy, alwaysOpen, "2026-09-17T09:32:00.000Z")).toBe(
      "2026-09-17T09:31:26.000Z",
    );
  });

  it("reports a stopped clock and no deadline for a case closed within target", () => {
    const closed = event("evt-closed", "2026-09-17T09:20:30.000Z", {
      type: "case_closed",
      fromState: "open",
      toState: "resolved",
    });
    const evaluation = evaluateCommitment(commitment, [created, closed], policy, alwaysOpen, AS_OF);
    expect(evaluation).toMatchObject({ status: "met", elapsedSeconds: 60, remainingSeconds: 60 });
    expect(evaluation.clock).toEqual({ state: "stopped", pausedSince: null, pauseCause: null });
    expect(evaluation.effectiveDueAt).toBeNull();
  });

  it("identifies its source event, and keeps its id, after the events are regenerated with new ids", () => {
    const before = evaluateCommitment(commitment, [created, pending], policy, alwaysOpen, AS_OF);
    const regenerated = [
      { ...created, id: "cmu5brjpz0481wkryec25m6un" },
      { ...pending, id: "cmu5brjpz0482wkryoj4jdmh4" },
    ];
    const after = evaluateCommitment(commitment, regenerated, policy, alwaysOpen, AS_OF);

    expect(before.inputs.lastEvent).toEqual({
      sourceRawEventId: "raw-audit",
      system: "zendesk",
      type: "state_changed",
      occurredAt: PAUSED,
      toState: "pending_customer",
    });
    expect(after.inputs).toEqual(before.inputs);
    expect(after.id).toBe(before.id);
  });

  it("ticket #45's first-response commitment keeps running through Pending and breaches at the nominal deadline", () => {
    const firstResponse: Commitment = { ...commitment, id: "commitment-45-fr", kind: "first_response" };
    const evaluation = evaluateCommitment(firstResponse, [created, pending], policy, alwaysOpen, AS_OF);

    expect(evaluation.status).toBe("breached");
    expect(evaluation.elapsedSeconds).toBe(210);
    expect(evaluation.remainingSeconds).toBe(-90);
    expect(evaluation.breachedBySeconds).toBe(90);
    expect(evaluation.clock).toEqual({ state: "running", pausedSince: null, pauseCause: null });
    expect(evaluation.effectiveDueAt).toBe(firstResponse.dueAt);
    expect(computeBreachedAt(firstResponse, [created, pending], policy, alwaysOpen, AS_OF)).toBe(firstResponse.dueAt);
  });
});
