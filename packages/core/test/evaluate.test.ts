import { describe, expect, it } from "vitest";
import {
  BREACH_NOTIFICATION_THRESHOLD,
  evaluateCommitment,
  evaluateEngineeringLegTarget,
  findCaseCloseEvent,
} from "../src/evaluate.js";
import type {
  BusinessCalendarVersion,
  Commitment,
  NormalizedEvent,
  SLAPolicyVersion,
} from "../src/types";

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
  targets: [{ kind: "resolution", minutes: 240 }],
  pauseOnStates: [],
  calendarVersionId: alwaysOpen.id,
  warnAtPercent: [50, 80, 95],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const commitment: Commitment = {
  id: "commitment-1",
  caseId: "case-1",
  kind: "resolution",
  cycleKey: "single",
  policyVersionId: policy.id,
  calendarVersionId: alwaysOpen.id,
  startedAt: "2026-09-07T09:00:00.000Z",
  targetMinutes: 240,
  dueAt: "2026-09-07T13:00:00.000Z",
  status: "on_track",
};

const baseEvents: NormalizedEvent[] = [
  {
    id: "evt-1",
    caseId: "case-1",
    type: "case_created",
    occurredAt: "2026-09-07T09:00:00.000Z",
    actor: "customer",
    system: "zendesk",
    sourceRole: "ticket_source",
    fromState: null,
    toState: "open",
    sourceRawEventId: "raw-1",
  },
];

function minutesAfterStart(minutes: number): string {
  return new Date(
    new Date(commitment.startedAt).getTime() + minutes * 60_000,
  ).toISOString();
}

describe("evaluateCommitment", () => {
  it("is on_track below the first warning threshold", () => {
    const evaluation = evaluateCommitment(
      commitment,
      baseEvents,
      policy,
      alwaysOpen,
      minutesAfterStart(100),
    );
    expect(evaluation.status).toBe("on_track");
    expect(evaluation.elapsedWorkingMinutes).toBe(100);
    expect(evaluation.remainingMinutes).toBe(140);
    expect(evaluation.warnThresholdCrossed).toBeUndefined();
  });

  it("transitions to at_risk once a warnAtPercent threshold is crossed", () => {
    // 200/240 = 83.3% — crosses the 80% threshold, but not yet breached.
    const evaluation = evaluateCommitment(
      commitment,
      baseEvents,
      policy,
      alwaysOpen,
      minutesAfterStart(200),
    );
    expect(evaluation.status).toBe("at_risk");
    expect(evaluation.remainingMinutes).toBe(40);
    expect(evaluation.warnThresholdCrossed).toBe(80);
  });

  it("reports the highest threshold crossed as elapsed keeps climbing within at_risk", () => {
    // 130/240 = 54.2% — crosses 50 but not 80. Same status as the 83.3% case
    // above, but notifications must key off the threshold, not the status,
    // or 80%/95% alerts would never fire while a commitment sits at at_risk.
    const evaluation = evaluateCommitment(
      commitment,
      baseEvents,
      policy,
      alwaysOpen,
      minutesAfterStart(130),
    );
    expect(evaluation.status).toBe("at_risk");
    expect(evaluation.warnThresholdCrossed).toBe(50);
  });

  it("transitions to breached once elapsed exceeds the target", () => {
    const evaluation = evaluateCommitment(
      commitment,
      baseEvents,
      policy,
      alwaysOpen,
      minutesAfterStart(250),
    );
    expect(evaluation.status).toBe("breached");
    expect(evaluation.breachedByMinutes).toBe(10);
    expect(evaluation.warnThresholdCrossed).toBe(BREACH_NOTIFICATION_THRESHOLD);
  });

  it("resolves to met when closed inside the target", () => {
    const events = [
      ...baseEvents,
      {
        id: "evt-close",
        caseId: "case-1",
        type: "case_closed" as const,
        occurredAt: minutesAfterStart(50),
        actor: "agent" as const,
        system: "zendesk" as const,
        sourceRole: "ticket_source" as const,
        fromState: "open" as const,
        toState: "resolved" as const,
        sourceRawEventId: "raw-close",
      },
    ];
    const evaluation = evaluateCommitment(
      commitment,
      events,
      policy,
      alwaysOpen,
      minutesAfterStart(300),
    );
    expect(evaluation.status).toBe("met");
    expect(evaluation.elapsedWorkingMinutes).toBe(50);
  });

  it("resolves to breached when closed past the target", () => {
    const events = [
      ...baseEvents,
      {
        id: "evt-close",
        caseId: "case-1",
        type: "case_closed" as const,
        occurredAt: minutesAfterStart(260),
        actor: "agent" as const,
        system: "zendesk" as const,
        sourceRole: "ticket_source" as const,
        fromState: "open" as const,
        toState: "resolved" as const,
        sourceRawEventId: "raw-close",
      },
    ];
    const evaluation = evaluateCommitment(
      commitment,
      events,
      policy,
      alwaysOpen,
      minutesAfterStart(300),
    );
    expect(evaluation.status).toBe("breached");
    expect(evaluation.breachedByMinutes).toBe(20);
    expect(evaluation.warnThresholdCrossed).toBe(BREACH_NOTIFICATION_THRESHOLD);
  });

  it("is reproducible: identical inputs called twice produce an identical Evaluation, id included", () => {
    const asOf = minutesAfterStart(200);
    const first = evaluateCommitment(
      commitment,
      baseEvents,
      policy,
      alwaysOpen,
      asOf,
    );
    const second = evaluateCommitment(
      commitment,
      baseEvents,
      policy,
      alwaysOpen,
      asOf,
    );
    expect(first).toEqual(second);
  });

  it("records the input version ids so any number can be re-derived and explained later", () => {
    const evaluation = evaluateCommitment(
      commitment,
      baseEvents,
      policy,
      alwaysOpen,
      minutesAfterStart(100),
    );
    expect(evaluation.inputs).toEqual({
      lastEvent: {
        sourceRawEventId: "raw-1",
        system: "zendesk",
        type: "case_created",
        occurredAt: "2026-09-07T09:00:00.000Z",
        toState: "open",
      },
      policyVersionId: policy.id,
      calendarVersionId: alwaysOpen.id,
    });
  });

  it("is not affected by a linked Jira issue reaching Done — only Zendesk closes a case", () => {
    // Zendesk ticket is still open; a linked Jira issue's own status
    // separately reached its "done" category (normalizes to "resolved"),
    // but Jira is never the anchor for the case's lifecycle.
    const events = [
      ...baseEvents,
      {
        id: "evt-jira-done",
        caseId: "case-1",
        type: "state_changed" as const,
        occurredAt: minutesAfterStart(50),
        actor: "agent" as const,
        system: "jira" as const,
        sourceRole: "work_tracker" as const,
        fromState: "in_progress" as const,
        toState: "resolved" as const,
        sourceRawEventId: "raw-jira",
      },
    ];
    const evaluation = evaluateCommitment(commitment, events, policy, alwaysOpen, minutesAfterStart(250));
    expect(evaluation.status).toBe("breached");
  });

  it("resumes live evaluation once a solved-then-reopened Zendesk ticket is active again", () => {
    const events = [
      ...baseEvents,
      {
        id: "evt-solved",
        caseId: "case-1",
        type: "case_closed" as const,
        occurredAt: minutesAfterStart(50),
        actor: "agent" as const,
        system: "zendesk" as const,
        sourceRole: "ticket_source" as const,
        fromState: "open" as const,
        toState: "resolved" as const,
        sourceRawEventId: "raw-solved",
      },
      {
        id: "evt-reopened",
        caseId: "case-1",
        type: "state_changed" as const,
        occurredAt: minutesAfterStart(60),
        actor: "customer" as const,
        system: "zendesk" as const,
        sourceRole: "ticket_source" as const,
        fromState: "resolved" as const,
        toState: "open" as const,
        sourceRawEventId: "raw-reopened",
      },
    ];
    // Elapsed since start (never actually paused) exceeds the 240-minute
    // target — since the ticket is open again, this must read live as
    // breached, not frozen at the stale "met" snapshot from the solve.
    const evaluation = evaluateCommitment(commitment, events, policy, alwaysOpen, minutesAfterStart(250));
    expect(evaluation.status).toBe("breached");
  });

  it("stops the clock at the solve, not at a later solved -> closed auto-close", () => {
    // Solved at 200m (inside the 240m target); a Zendesk automation closes
    // it four days later. The close doesn't reopen anything, so elapsed
    // must stay at 200m rather than running until the auto-close.
    const events = [
      ...baseEvents,
      zendeskEvent("case_closed", "open", "resolved", minutesAfterStart(200)),
      zendeskEvent("case_closed", "resolved", "closed", minutesAfterStart(4 * 24 * 60), "system"),
    ];
    const evaluation = evaluateCommitment(commitment, events, policy, alwaysOpen, minutesAfterStart(5 * 24 * 60));
    expect(evaluation.status).toBe("met");
    expect(evaluation.elapsedWorkingMinutes).toBe(200);
    expect(evaluation.remainingMinutes).toBe(40);
  });

  it("stops the clock at the final solve of a solve -> reopen -> solve -> auto-close ticket", () => {
    const events = [
      ...baseEvents,
      zendeskEvent("case_closed", "open", "resolved", minutesAfterStart(50)),
      zendeskEvent("state_changed", "resolved", "open", minutesAfterStart(60), "customer"),
      zendeskEvent("case_closed", "open", "resolved", minutesAfterStart(230)),
      zendeskEvent("case_closed", "resolved", "closed", minutesAfterStart(4 * 24 * 60), "system"),
    ];
    const evaluation = evaluateCommitment(commitment, events, policy, alwaysOpen, minutesAfterStart(5 * 24 * 60));
    expect(evaluation.status).toBe("met");
    // 0-50 running, 50-60 excluded (D3: solved before the reopen), 60-230
    // running: 50 + 170 = 220m — not 230, which would count the solved gap.
    expect(evaluation.elapsedWorkingMinutes).toBe(220);
  });

  it("does not let a linked Jira transition end a Zendesk customer pause (ticket 20 regression)", () => {
    // Zendesk: created 21:33:56, pending 21:37:12, solved 22:43:48, auto-closed
    // four days later. Jira: in_progress at 22:42:16 while Zendesk is still
    // pending. Previously Jira ended the pause and the clock ran to the
    // auto-close (~5787m, breached); only the 3m16s before pending count.
    // Resolution, since first response never pauses (clock-rules.ts).
    const resolution: Commitment = {
      ...commitment,
      kind: "resolution",
      startedAt: "2026-09-09T21:33:56.000Z",
      targetMinutes: 60,
      dueAt: "2026-09-09T22:33:56.000Z",
    };
    const pausingPolicy: SLAPolicyVersion = { ...policy, pauseOnStates: ["pending_customer"] };
    const events: NormalizedEvent[] = [
      zendeskEvent("case_created", null, "new", "2026-09-09T21:33:56.000Z", "customer"),
      jiraEvent(null, "new", "2026-09-09T21:34:02.821Z"),
      jiraEvent("new", "in_progress", "2026-09-09T21:34:14.984Z"),
      zendeskEvent("state_changed", "new", "open", "2026-09-09T21:35:48.000Z"),
      jiraEvent("in_progress", "resolved", "2026-09-09T21:36:32.180Z"),
      zendeskEvent("state_changed", "open", "pending_customer", "2026-09-09T21:37:12.000Z"),
      jiraEvent("resolved", "in_progress", "2026-09-09T22:42:16.591Z"),
      zendeskEvent("case_closed", "pending_customer", "resolved", "2026-09-09T22:43:48.000Z"),
      jiraEvent("in_progress", "resolved", "2026-09-13T09:12:30.113Z"),
      zendeskEvent("case_closed", "resolved", "closed", "2026-09-13T23:05:50.000Z", "system"),
    ];

    const evaluation = evaluateCommitment(
      resolution,
      events,
      pausingPolicy,
      alwaysOpen,
      "2026-09-17T09:00:00.000Z",
    );
    expect(evaluation.status).toBe("met");
    expect(evaluation.elapsedWorkingMinutes).toBeCloseTo(196 / 60, 5);
  });
});

let helperSeq = 0;
function zendeskEvent(
  type: NormalizedEvent["type"],
  fromState: NormalizedEvent["fromState"],
  toState: NormalizedEvent["toState"],
  occurredAt: string,
  actor: NormalizedEvent["actor"] = "agent",
): NormalizedEvent {
  helperSeq += 1;
  return {
    id: `evt-zd-${helperSeq}`,
    caseId: "case-1",
    type,
    occurredAt,
    actor,
    system: "zendesk",
    sourceRole: "ticket_source",
    fromState,
    toState,
    sourceRawEventId: `raw-zd-${helperSeq}`,
  };
}

function jiraEvent(
  fromState: NormalizedEvent["fromState"],
  toState: NormalizedEvent["toState"],
  occurredAt: string,
): NormalizedEvent {
  helperSeq += 1;
  return {
    id: `evt-jira-${helperSeq}`,
    caseId: "case-1",
    type: "state_changed",
    occurredAt,
    actor: "agent",
    system: "jira",
    sourceRole: "work_tracker",
    fromState,
    toState,
    sourceRawEventId: `raw-jira-${helperSeq}`,
  };
}

describe("evaluateEngineeringLegTarget", () => {
  it("is on_track well below the target while the leg is still open", () => {
    const evaluation = evaluateEngineeringLegTarget(60, 240, true);
    expect(evaluation.status).toBe("on_track");
    expect(evaluation.remainingMinutes).toBe(180);
    expect(evaluation.breachedByMinutes).toBeUndefined();
  });

  it("transitions to at_risk once the fixed 80% warn threshold is crossed while still open", () => {
    // 200/240 = 83.3%
    const evaluation = evaluateEngineeringLegTarget(200, 240, true);
    expect(evaluation.status).toBe("at_risk");
    expect(evaluation.remainingMinutes).toBe(40);
  });

  it("is breached once elapsed exceeds the target, even while the leg is still open", () => {
    const evaluation = evaluateEngineeringLegTarget(250, 240, true);
    expect(evaluation.status).toBe("breached");
    expect(evaluation.breachedByMinutes).toBe(10);
  });

  it("resolves to met once the leg has closed under target", () => {
    const evaluation = evaluateEngineeringLegTarget(100, 240, false);
    expect(evaluation.status).toBe("met");
  });

  it("stays breached once the leg has closed over target", () => {
    const evaluation = evaluateEngineeringLegTarget(300, 240, false);
    expect(evaluation.status).toBe("breached");
    expect(evaluation.breachedByMinutes).toBe(60);
  });

  it("never reports met while the leg is still open, regardless of elapsed time", () => {
    const evaluation = evaluateEngineeringLegTarget(10, 240, true);
    expect(evaluation.status).not.toBe("met");
  });
});

describe("findCaseCloseEvent", () => {
  it("returns null when the case has never closed", () => {
    expect(findCaseCloseEvent(baseEvents, minutesAfterStart(100))).toBeNull();
  });

  it("returns the case_closed event once the case has closed", () => {
    const closeEvent = {
      id: "evt-close",
      caseId: "case-1",
      type: "case_closed" as const,
      occurredAt: minutesAfterStart(50),
      actor: "agent" as const,
      system: "zendesk" as const,
      sourceRole: "ticket_source" as const,
      fromState: "open" as const,
      toState: "resolved" as const,
      sourceRawEventId: "raw-close",
    };
    expect(findCaseCloseEvent([...baseEvents, closeEvent], minutesAfterStart(100))).toEqual(closeEvent);
  });

  it("ignores a case_closed event that happens after asOf", () => {
    const closeEvent = {
      id: "evt-close",
      caseId: "case-1",
      type: "case_closed" as const,
      occurredAt: minutesAfterStart(200),
      actor: "agent" as const,
      system: "zendesk" as const,
      sourceRole: "ticket_source" as const,
      fromState: "open" as const,
      toState: "resolved" as const,
      sourceRawEventId: "raw-close",
    };
    expect(findCaseCloseEvent([...baseEvents, closeEvent], minutesAfterStart(100))).toBeNull();
  });

  it("returns a closed Intercom conversation's case_closed event", () => {
    const closeEvent = {
      id: "evt-intercom-close",
      caseId: "case-1",
      type: "case_closed" as const,
      occurredAt: minutesAfterStart(50),
      actor: "agent" as const,
      system: "intercom" as const,
      sourceRole: "ticket_source" as const,
      fromState: "open" as const,
      toState: "resolved" as const,
      sourceRawEventId: "raw-intercom-close",
    };
    expect(findCaseCloseEvent([...baseEvents, closeEvent], minutesAfterStart(100))).toEqual(closeEvent);
  });

  it("ignores a Jira issue reaching a resolved/done category", () => {
    const jiraDone = {
      id: "evt-jira-done",
      caseId: "case-1",
      type: "state_changed" as const,
      occurredAt: minutesAfterStart(50),
      actor: "agent" as const,
      system: "jira" as const,
      sourceRole: "work_tracker" as const,
      fromState: "in_progress" as const,
      toState: "resolved" as const,
      sourceRawEventId: "raw-jira",
    };
    expect(findCaseCloseEvent([...baseEvents, jiraDone], minutesAfterStart(100))).toBeNull();
  });

  it("returns null once a solved Zendesk ticket has been reopened", () => {
    const solved = {
      id: "evt-solved",
      caseId: "case-1",
      type: "case_closed" as const,
      occurredAt: minutesAfterStart(50),
      actor: "agent" as const,
      system: "zendesk" as const,
      sourceRole: "ticket_source" as const,
      fromState: "open" as const,
      toState: "resolved" as const,
      sourceRawEventId: "raw-solved",
    };
    const reopened = {
      id: "evt-reopened",
      caseId: "case-1",
      type: "state_changed" as const,
      occurredAt: minutesAfterStart(60),
      actor: "customer" as const,
      system: "zendesk" as const,
      sourceRole: "ticket_source" as const,
      fromState: "resolved" as const,
      toState: "open" as const,
      sourceRawEventId: "raw-reopened",
    };
    expect(findCaseCloseEvent([...baseEvents, solved, reopened], minutesAfterStart(100))).toBeNull();
  });

  it("returns the solve, not the later solved -> closed auto-close", () => {
    const solved = zendeskEvent("case_closed", "open", "resolved", minutesAfterStart(50));
    const autoClosed = zendeskEvent("case_closed", "resolved", "closed", minutesAfterStart(5000), "system");
    expect(findCaseCloseEvent([...baseEvents, solved, autoClosed], minutesAfterStart(6000))).toEqual(solved);
    // Before the auto-close has happened the answer is the same solve.
    expect(findCaseCloseEvent([...baseEvents, solved, autoClosed], minutesAfterStart(100))).toEqual(solved);
  });

  it("returns the solve that followed the latest reopen, not the first solve", () => {
    const firstSolve = zendeskEvent("case_closed", "open", "resolved", minutesAfterStart(50));
    const reopened = zendeskEvent("state_changed", "resolved", "open", minutesAfterStart(60), "customer");
    const secondSolve = zendeskEvent("case_closed", "open", "resolved", minutesAfterStart(90));
    const autoClosed = zendeskEvent("case_closed", "resolved", "closed", minutesAfterStart(5000), "system");
    expect(
      findCaseCloseEvent([...baseEvents, firstSolve, reopened, secondSolve, autoClosed], minutesAfterStart(6000)),
    ).toEqual(secondSolve);
  });

  it("is not reset by a Jira transition landing between the solve and the auto-close", () => {
    const solved = zendeskEvent("case_closed", "open", "resolved", minutesAfterStart(50));
    const jira = jiraEvent("resolved", "in_progress", minutesAfterStart(70));
    const autoClosed = zendeskEvent("case_closed", "resolved", "closed", minutesAfterStart(5000), "system");
    expect(findCaseCloseEvent([...baseEvents, solved, jira, autoClosed], minutesAfterStart(6000))).toEqual(solved);
  });
});

describe("evaluateCommitment with out-of-order and empty event lists", () => {
  function caseEvent(
    id: string,
    minutes: number,
    partial: Pick<NormalizedEvent, "type" | "fromState" | "toState"> & Partial<NormalizedEvent>,
  ): NormalizedEvent {
    return {
      id,
      caseId: "case-1",
      occurredAt: minutesAfterStart(minutes),
      actor: "agent",
      system: "zendesk",
      sourceRole: "ticket_source",
      sourceRawEventId: `raw-${id}`,
      ...partial,
    };
  }

  const pausingPolicy: SLAPolicyVersion = { ...policy, pauseOnStates: ["pending_customer"] };

  // open 0–60, paused 60–100, open 100–150, closed at 150 → 110 working minutes.
  const chronological: NormalizedEvent[] = [
    caseEvent("evt-created", 0, { type: "case_created", fromState: null, toState: "open", actor: "customer" }),
    caseEvent("evt-pending", 60, { type: "state_changed", fromState: "open", toState: "pending_customer" }),
    caseEvent("evt-reply", 100, { type: "state_changed", fromState: "pending_customer", toState: "open", actor: "customer" }),
    caseEvent("evt-solved", 150, { type: "case_closed", fromState: "open", toState: "resolved" }),
  ];

  it("gives the same Evaluation, id included, for a shuffled event list", () => {
    const expected = evaluateCommitment(commitment, chronological, pausingPolicy, alwaysOpen, minutesAfterStart(300));
    expect(expected).toMatchObject({ status: "met", elapsedWorkingMinutes: 110 });
    expect(expected.inputs.lastEvent?.sourceRawEventId).toBe("raw-evt-solved");

    const shuffles = [
      [...chronological].reverse(),
      [chronological[2]!, chronological[0]!, chronological[3]!, chronological[1]!],
      [chronological[3]!, chronological[1]!, chronological[0]!, chronological[2]!],
    ];
    for (const shuffled of shuffles) {
      expect(evaluateCommitment(commitment, shuffled, pausingPolicy, alwaysOpen, minutesAfterStart(300))).toEqual(
        expected,
      );
    }
  });

  it("does not mutate the caller's event array while sorting", () => {
    const reversed = [...chronological].reverse();
    const snapshot = reversed.map((e) => e.id);
    evaluateCommitment(commitment, reversed, pausingPolicy, alwaysOpen, minutesAfterStart(300));
    expect(reversed.map((e) => e.id)).toEqual(snapshot);
  });

  it("uses the chronologically last event up to asOf as lastEvent, not the last array element", () => {
    // asOf is before the close, so the case is still paused-then-open and live.
    const shuffled = [chronological[3]!, chronological[2]!, chronological[0]!, chronological[1]!];
    const evaluation = evaluateCommitment(commitment, shuffled, pausingPolicy, alwaysOpen, minutesAfterStart(120));
    expect(evaluation.inputs.lastEvent?.sourceRawEventId).toBe("raw-evt-reply");
    expect(evaluation.status).toBe("on_track");
    expect(evaluation.elapsedWorkingMinutes).toBe(80);
  });

  it("ignores other cases' events mixed into the list", () => {
    const otherCase = { ...chronological[3]!, id: "evt-other-close", caseId: "case-2", occurredAt: minutesAfterStart(10) };
    const evaluation = evaluateCommitment(
      commitment,
      [otherCase, ...chronological.slice(0, 3)],
      pausingPolicy,
      alwaysOpen,
      minutesAfterStart(120),
    );
    expect(evaluation.status).toBe("on_track");
    expect(evaluation.inputs.lastEvent?.sourceRawEventId).toBe("raw-evt-reply");
  });

  it("runs the clock from commitment.startedAt with no lastEvent for an empty event list", () => {
    // The clock is measured over the commitment's own window, not between
    // its first and last events, so with nothing to pause it the whole
    // window runs. Unreachable in practice: every ticket source writes
    // case_created at the case's open time, which is what startedAt is set from.
    const evaluation = evaluateCommitment(commitment, [], policy, alwaysOpen, minutesAfterStart(1000));
    expect(evaluation).toMatchObject({
      status: "breached",
      elapsedWorkingMinutes: 1000,
      remainingMinutes: -760,
      warnThresholdCrossed: BREACH_NOTIFICATION_THRESHOLD,
      breachedByMinutes: 760,
      clock: { state: "running", pausedSince: null, pauseCause: null },
      effectiveDueAt: minutesAfterStart(240),
      inputs: { lastEvent: null, policyVersionId: policy.id, calendarVersionId: alwaysOpen.id },
    });
    expect(evaluateCommitment(commitment, [], policy, alwaysOpen, minutesAfterStart(1000)).id).toBe(evaluation.id);
  });

  it("treats a list with only another case's events like an empty one", () => {
    const otherCaseOnly = chronological.map((e) => ({ ...e, caseId: "case-2" }));
    const evaluation = evaluateCommitment(commitment, otherCaseOnly, policy, alwaysOpen, minutesAfterStart(1000));
    expect(evaluation).toEqual(evaluateCommitment(commitment, [], policy, alwaysOpen, minutesAfterStart(1000)));
  });
});
