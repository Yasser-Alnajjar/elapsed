import { withSourceRole } from "./source-role";
import { describe, expect, it } from "vitest";
import { createCommitment } from "../src/commitments";
import { computeElapsedWorkingMinutes, foldClockIntervals } from "../src/elapsed";
import { computeBreachedAt, evaluateCommitment } from "../src/evaluate";
import type {
  BusinessCalendarVersion,
  ClockFold,
  CommitmentKind,
  NormalizedEvent,
  NormalizedEventType,
  NormalizedState,
  SLAPolicyVersion,
} from "../src/types";

/**
 * The SLA clock is measured over an explicit window (`ClockWindow`), never
 * from the case's first event to its last. Events before `window.start` set
 * the state the clock opens in but add no elapsed time; events after
 * `window.end` are ignored.
 */

const alwaysOpen: BusinessCalendarVersion = {
  id: "cal-24-7",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};

const policy: SLAPolicyVersion = {
  id: "policy-v1",
  policyId: "policy",
  version: 1,
  match: {},
  targets: [
    { kind: "first_response", minutes: 120 },
    { kind: "resolution", minutes: 300 },
  ],
  pauseOnStates: ["pending_customer"],
  calendarVersionId: alwaysOpen.id,
  warnAtPercent: [50, 80, 95],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const PAUSES: NormalizedState[] = ["pending_customer"];

const at = (time: string) => `2026-09-17T${time}:00.000Z`;
const window = (start: string, end: string) => ({ start: at(start), end: at(end) });

let seq = 0;
function event(
  time: string,
  type: NormalizedEventType,
  toState: NormalizedState | null,
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  seq += 1;
  return withSourceRole({
    id: `evt-${seq}`,
    caseId: "case-1",
    type,
    occurredAt: at(time),
    actor: "agent",
    system: "zendesk",
    fromState: null,
    toState,
    sourceRawEventId: `raw-${seq}`,
    sourceSequence: seq,
    ...overrides,
  });
}

const jira = (time: string, toState: NormalizedState) =>
  event(time, "state_changed", toState, { system: "jira" });

/** A fold's intervals as `HH:MM` pairs, for readable assertions. */
function intervals(fold: ClockFold) {
  const hhmm = (iso: string) => iso.slice(11, 16);
  return {
    running: fold.runningIntervals.map((i) => [hhmm(i.start.toISOString()), hhmm(i.end.toISOString())]),
    paused: fold.pausedIntervals.map((i) => [hhmm(i.start), hhmm(i.end)]),
  };
}

describe("foldClockIntervals over an explicit window", () => {
  it("adds no elapsed time for events before the window", () => {
    const events = [event("09:00", "case_created", "open"), jira("10:00", "in_progress")];

    const fold = foldClockIntervals(events, PAUSES, window("11:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [["11:00", "12:00"]], paused: [] });
    expect(computeElapsedWorkingMinutes(events, PAUSES, alwaysOpen, window("11:00", "12:00")).elapsedWorkingMinutes).toBe(60);
  });

  it("opens paused when a pause state was entered before the window, clipping the pause to the window", () => {
    const events = [event("09:00", "case_created", "pending_customer"), event("11:00", "state_changed", "open")];

    const fold = foldClockIntervals(events, PAUSES, window("10:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [["11:00", "12:00"]], paused: [["10:00", "11:00"]] });
    expect(fold.currentPause).toBeNull();
  });

  it("keeps the real pausedSince of a pause that began before the window", () => {
    const events = [event("09:00", "case_created", "pending_customer"), event("11:00", "state_changed", "open")];

    const fold = foldClockIntervals(events, PAUSES, window("10:00", "10:30"));
    expect(intervals(fold)).toEqual({ running: [], paused: [["10:00", "10:30"]] });
    expect(fold.currentPause).toEqual({ since: at("09:00"), cause: "pending_customer" });
  });

  it("opens running when a pre-window pause ends exactly at the window start", () => {
    const events = [event("09:00", "case_created", "pending_customer"), event("10:00", "state_changed", "open")];

    const fold = foldClockIntervals(events, PAUSES, window("10:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [["10:00", "12:00"]], paused: [] });
    expect(fold.currentPause).toBeNull();
  });

  it("opens paused when the pause begins exactly at the window start", () => {
    const events = [event("09:00", "case_created", "open"), event("10:00", "state_changed", "pending_customer")];

    const fold = foldClockIntervals(events, PAUSES, window("10:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [], paused: [["10:00", "12:00"]] });
    expect(fold.currentPause).toEqual({ since: at("10:00"), cause: "pending_customer" });
  });

  it("does not let a pause that began and ended before the window leak into it", () => {
    const events = [
      event("09:00", "case_created", "open"),
      event("09:15", "state_changed", "pending_customer"),
      event("09:45", "state_changed", "open"),
    ];

    const fold = foldClockIntervals(events, PAUSES, window("10:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [["10:00", "12:00"]], paused: [] });
  });

  it("runs to the explicit window end, not the last event", () => {
    const events = [event("09:00", "case_created", "open")];

    const fold = foldClockIntervals(events, PAUSES, window("09:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [["09:00", "12:00"]], paused: [] });
  });

  it("ignores events after the window end", () => {
    const events = [event("09:00", "case_created", "open"), event("13:00", "state_changed", "pending_customer")];

    const fold = foldClockIntervals(events, PAUSES, window("09:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [["09:00", "12:00"]], paused: [] });
    expect(fold.currentPause).toBeNull();
  });

  it("runs the whole window when there are no events", () => {
    expect(intervals(foldClockIntervals([], PAUSES, window("10:00", "12:00")))).toEqual({
      running: [["10:00", "12:00"]],
      paused: [],
    });
  });

  it("yields no intervals for an empty or inverted window", () => {
    const events = [event("09:00", "case_created", "open")];

    expect(intervals(foldClockIntervals(events, PAUSES, window("10:00", "10:00")))).toEqual({ running: [], paused: [] });
    expect(intervals(foldClockIntervals(events, PAUSES, window("11:00", "10:00")))).toEqual({ running: [], paused: [] });
  });

  it("keeps a pre-window Zendesk pause through Jira transitions before and inside the window", () => {
    const events = [
      event("09:00", "case_created", "open"),
      event("09:30", "state_changed", "pending_customer"),
      jira("09:45", "in_progress"),
      jira("10:30", "resolved"),
      event("11:00", "state_changed", "open"),
    ];

    const fold = foldClockIntervals(events, PAUSES, window("10:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [["11:00", "12:00"]], paused: [["10:00", "11:00"]] });
  });

  it("does not count a linked Jira issue's history from before the case opened", () => {
    // A pre-existing Jira issue created at 08:00, linked to a ticket opened at 09:00.
    const events = [jira("08:00", "new"), event("09:00", "case_created", "open")];

    const fold = foldClockIntervals(events, PAUSES, window("09:00", "12:00"));
    expect(intervals(fold)).toEqual({ running: [["09:00", "12:00"]], paused: [] });
  });
});

const commitmentStartingAt = (kind: CommitmentKind, time: string) =>
  createCommitment("case-1", kind, at(time), policy, alwaysOpen);

describe("evaluateCommitment over the commitment's own window", () => {
  // 09:00 case opens · 10:00 unrelated Jira event · 11:00 commitment starts.
  const lateStartEvents = [event("09:00", "case_created", "open"), jira("10:00", "in_progress")];

  it("counts first response only from commitment.startedAt, not the case's first event", () => {
    const commitment = commitmentStartingAt("first_response", "11:00");

    const evaluation = evaluateCommitment(commitment, lateStartEvents, policy, alwaysOpen, at("12:00"));
    expect(evaluation).toMatchObject({
      status: "at_risk",
      elapsedWorkingMinutes: 60,
      remainingMinutes: 60,
      clock: { state: "running", pausedSince: null },
      effectiveDueAt: at("13:00"),
    });
    // The event before the window is still an input.
    expect(evaluation.inputs.lastEvent?.system).toBe("jira");
  });

  it("does not breach first response on a linked Jira issue created before the ticket", () => {
    const commitment = commitmentStartingAt("first_response", "09:00");
    const events = [jira("08:00", "new"), event("09:00", "case_created", "open")];

    const evaluation = evaluateCommitment(commitment, events, policy, alwaysOpen, at("10:30"));
    expect(evaluation.status).toBe("at_risk");
    expect(evaluation.elapsedWorkingMinutes).toBe(90);
  });

  it("opens a resolution clock paused on a pause entered before the window, keeping the real pausedSince", () => {
    const commitment = commitmentStartingAt("resolution", "10:00");
    const events = [event("09:00", "case_created", "pending_customer"), event("11:00", "state_changed", "open")];

    const whilePaused = evaluateCommitment(commitment, events, policy, alwaysOpen, at("10:30"));
    expect(whilePaused).toMatchObject({
      status: "on_track",
      elapsedWorkingMinutes: 0,
      clock: { state: "paused", pausedSince: at("09:00"), pauseCause: "pending_customer" },
      effectiveDueAt: null,
    });

    const afterResume = evaluateCommitment(commitment, events, policy, alwaysOpen, at("12:00"));
    expect(afterResume.elapsedWorkingMinutes).toBe(60); // paused 10–11, running 11–12
    expect(afterResume.clock.state).toBe("running");
  });

  it("never pauses first response on a pre-window pause state", () => {
    const commitment = commitmentStartingAt("first_response", "10:00");
    const events = [event("09:00", "case_created", "pending_customer"), event("11:00", "state_changed", "open")];

    const evaluation = evaluateCommitment(commitment, events, policy, alwaysOpen, at("11:30"));
    expect(evaluation.elapsedWorkingMinutes).toBe(90);
    expect(evaluation.clock.state).toBe("running");
  });
});

describe("computeBreachedAt over the commitment's own window", () => {
  it("puts the breach target minutes after commitment.startedAt, not after the case's first event", () => {
    const commitment = commitmentStartingAt("first_response", "11:00");
    const events = [event("09:00", "case_created", "open"), jira("10:00", "in_progress")];

    expect(computeBreachedAt(commitment, events, policy, alwaysOpen, at("12:00"))).toBeNull();
    expect(computeBreachedAt(commitment, events, policy, alwaysOpen, at("14:00"))).toBe(at("13:00"));
  });

  it("ignores a linked Jira issue's history from before the ticket", () => {
    const commitment = commitmentStartingAt("first_response", "09:00");
    const events = [jira("08:00", "new"), event("09:00", "case_created", "open")];

    expect(computeBreachedAt(commitment, events, policy, alwaysOpen, at("12:00"))).toBe(at("11:00"));
  });

  it("pushes the breach out by the clipped part of a pause entered before the window", () => {
    // Paused 10:00–11:00 inside the window, so the 300m resolution target runs out at 16:00, not 15:00.
    const commitment = commitmentStartingAt("resolution", "10:00");
    const events = [event("09:00", "case_created", "pending_customer"), event("11:00", "state_changed", "open")];

    expect(computeBreachedAt(commitment, events, policy, alwaysOpen, at("18:00"))).toBe(at("16:00"));
  });
});

/**
 * D3 (1.4, decided): Resolution excludes time spent solved from a
 * solve-to-reopen interval — matching Zendesk. `foldClockIntervals` reads
 * `case_closed` as a state transition too (not just `state_changed`/
 * `case_created`), and `resolution`'s clock rule pauses on `resolved`
 * unconditionally, on top of the policy's own pause states
 * (clock-rules.ts).
 */
describe("Resolution solved -> reopened (D3)", () => {
  const resolution = () => commitmentStartingAt("resolution", "09:00");

  it("stops at the solve while the case stays solved", () => {
    const events = [event("09:00", "case_created", "open"), event("10:00", "case_closed", "resolved")];

    const evaluation = evaluateCommitment(resolution(), events, policy, alwaysOpen, at("12:00"));
    expect(evaluation).toMatchObject({ status: "met", elapsedWorkingMinutes: 60, clock: { state: "stopped" } });
  });

  it("excludes the solved interval from running time once the case is reopened", () => {
    const events = [
      event("09:00", "case_created", "open"),
      event("10:00", "case_closed", "resolved"),
      event("15:00", "state_changed", "open"),
    ];

    // Running: 09:00-10:00 (60m) + 15:00-16:00 (60m) = 120m — the 09:30-15:00
    // solved interval is excluded (D3), not counted as it was before.
    const evaluation = evaluateCommitment(resolution(), events, policy, alwaysOpen, at("16:00"));
    expect(evaluation).toMatchObject({ status: "on_track", elapsedWorkingMinutes: 120, clock: { state: "running" } });
    expect(computeBreachedAt(resolution(), events, policy, alwaysOpen, at("16:00"))).toBeNull();
  });

  it("keeps a pause entered before the solve through the solved interval after a reopen", () => {
    const events = [
      event("09:00", "case_created", "open"),
      event("09:30", "state_changed", "pending_customer"),
      event("10:00", "case_closed", "resolved"),
      event("15:00", "state_changed", "open"),
    ];

    const evaluation = evaluateCommitment(resolution(), events, policy, alwaysOpen, at("16:00"));
    expect(evaluation).toMatchObject({ status: "on_track", elapsedWorkingMinutes: 90, clock: { state: "running" } });
  });
});
