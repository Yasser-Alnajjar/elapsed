import { withSourceRole } from "./source-role";
import { describe, expect, it } from "vitest";
import { createCommitment } from "../src/commitments";
import {
  computeBreachedAt,
  evaluateCommitment,
  findCompletionEvent,
  findFirstResponseEvent,
  resolveFirstResponseStartedAt,
} from "../src/evaluate";
import type {
  BusinessCalendarVersion,
  CommitmentKind,
  NormalizedEvent,
  NormalizedEventType,
  NormalizedState,
  SLAPolicyVersion,
} from "../src/types";

/**
 * First response and resolution share one calendar and elapsed-time fold but
 * complete on different events (the first agent reply vs. the case close) and
 * pause differently: resolution pauses on the policy's pause states, first
 * response never pauses (clock-rules.ts).
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
    { kind: "resolution", minutes: 480 },
  ],
  pauseOnStates: ["pending_customer"],
  calendarVersionId: alwaysOpen.id,
  warnAtPercent: [50, 80, 95],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const at = (time: string) => `2026-09-17T${time}:00.000Z`;

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
    ...overrides,
  });
}

const commitmentFor = (kind: CommitmentKind) =>
  createCommitment("case-1", kind, at("10:00"), policy, alwaysOpen);

const evaluate = (kind: CommitmentKind, events: NormalizedEvent[], asOf: string) =>
  evaluateCommitment(commitmentFor(kind), events, policy, alwaysOpen, at(asOf));

// 10:00 created · 10:30 pending · 11:30 customer replies · 12:00 agent's
// first public reply · 15:00 pending · 16:00 customer replies · 17:00 solved.
const scenario: NormalizedEvent[] = [
  event("10:00", "case_created", "new", { actor: "customer" }),
  event("10:30", "state_changed", "pending_customer"),
  event("11:30", "state_changed", "open", { actor: "customer" }),
  event("12:00", "agent_replied", null),
  event("15:00", "state_changed", "pending_customer"),
  event("16:00", "state_changed", "open", { actor: "customer" }),
  event("17:00", "case_closed", "resolved"),
];

describe("first response vs. resolution on the same case", () => {
  it("first response completes met at the first agent reply, counting the Pending hour", () => {
    // 10:00–12:00 with no pause is exactly the 120m target: met, not breached.
    const evaluation = evaluate("first_response", scenario, "12:00");
    expect(evaluation).toMatchObject({
      status: "met",
      elapsedWorkingMinutes: 120,
      remainingMinutes: 0,
      clock: { state: "stopped", pausedSince: null, pauseCause: null },
      effectiveDueAt: null,
      warnThresholdCrossed: undefined,
    });
  });

  it("first response stays met and frozen for the rest of the case", () => {
    for (const asOf of ["13:00", "15:30", "17:00", "23:00"]) {
      expect(evaluate("first_response", scenario, asOf)).toMatchObject({
        status: "met",
        elapsedWorkingMinutes: 120,
        clock: { state: "stopped" },
      });
    }
    expect(
      computeBreachedAt(commitmentFor("first_response"), scenario, policy, alwaysOpen, at("23:00")),
    ).toBeNull();
  });

  it("resolution is unaffected by the reply and completes met at the close", () => {
    expect(evaluate("resolution", scenario, "13:00")).toMatchObject({
      status: "on_track",
      elapsedWorkingMinutes: 120,
      clock: { state: "running" },
    });
    expect(evaluate("resolution", scenario, "17:00")).toMatchObject({
      status: "met",
      elapsedWorkingMinutes: 300,
      remainingMinutes: 180,
      clock: { state: "stopped" },
    });
  });

  it("first response met can coexist with resolution still open", () => {
    expect(evaluate("first_response", scenario, "15:30").status).toBe("met");
    expect(evaluate("resolution", scenario, "15:30")).toMatchObject({
      status: "at_risk",
      clock: { state: "paused" },
    });
  });

  it("first response breaches at the target crossing when no agent has replied yet", () => {
    const noReply = scenario.filter((e) => e.type !== "agent_replied");
    const evaluation = evaluate("first_response", noReply, "13:00");
    expect(evaluation).toMatchObject({
      status: "breached",
      clock: { state: "running" },
      effectiveDueAt: at("12:00"),
    });
  });

  it("a late reply finalizes first response as breached, by the running time up to the reply", () => {
    const lateReply = [
      ...scenario.filter((e) => e.type !== "agent_replied"),
      event("14:00", "agent_replied", null),
    ];
    const evaluation = evaluate("first_response", lateReply, "17:00");
    expect(evaluation).toMatchObject({
      status: "breached",
      elapsedWorkingMinutes: 240,
      breachedByMinutes: 120,
      clock: { state: "stopped" },
      effectiveDueAt: at("12:00"),
    });
  });

  it("a first-response breach does not affect resolution", () => {
    const noReply = scenario.filter((e) => e.type !== "agent_replied");
    expect(evaluate("first_response", noReply, "16:30").status).toBe("breached");
    expect(evaluate("resolution", noReply, "16:30").status).toBe("at_risk");
  });

  it("a reply-less close (D5) finalizes first response as breached, never met, even inside the target", () => {
    // Close well past the 120m target: still breached, and now finalized
    // (stopped) at the close rather than running forever.
    const noReply = scenario.filter((e) => e.type !== "agent_replied");
    const evaluation = evaluate("first_response", noReply, "23:00");
    expect(evaluation).toMatchObject({ status: "breached", clock: { state: "stopped" } });
  });

  it("a reply-less close inside the target is still breached, not met (D5)", () => {
    // Closed at 30m — well inside the 120m target — with no agent reply ever.
    const events = [
      event("10:00", "case_created", "new", { actor: "customer" }),
      event("10:30", "case_closed", "resolved"),
    ];
    const evaluation = evaluate("first_response", events, "10:30");
    expect(evaluation).toMatchObject({
      status: "breached",
      elapsedWorkingMinutes: 30,
      clock: { state: "stopped" },
    });
  });
});

describe("on-hold does not pause resolution (D7, MVP)", () => {
  it("keeps the resolution clock running through pending_internal, unlike pending_customer", () => {
    const events: NormalizedEvent[] = [
      event("10:00", "case_created", "new", { actor: "customer" }),
      event("10:30", "state_changed", "pending_internal"),
      event("11:00", "state_changed", "open", { actor: "agent" }),
    ];
    // pauseOnStates is the MVP default (pending_customer only) — on-hold is
    // deliberately absent, not merely "this policy happens not to list it".
    const evaluation = evaluate("resolution", events, "12:00");
    expect(evaluation).toMatchObject({
      elapsedWorkingMinutes: 120,
      clock: { state: "running", pausedSince: null, pauseCause: null },
    });
  });
});

describe("Pending before the first agent reply", () => {
  it("keeps the first-response clock running while resolution pauses", () => {
    expect(evaluate("first_response", scenario, "11:00")).toMatchObject({
      status: "at_risk",
      elapsedWorkingMinutes: 60,
      clock: { state: "running", pausedSince: null, pauseCause: null },
      effectiveDueAt: at("12:00"),
    });
    expect(evaluate("resolution", scenario, "11:00")).toMatchObject({
      elapsedWorkingMinutes: 30,
      clock: { state: "paused", pausedSince: at("10:30"), pauseCause: "pending_customer" },
      effectiveDueAt: null,
    });
  });

  it("does not pause first response even when the policy pauses on more states", () => {
    const events = [
      event("10:00", "case_created", "new", { actor: "customer" }),
      event("10:30", "state_changed", "pending_internal"),
    ];
    const broadPolicy: SLAPolicyVersion = { ...policy, pauseOnStates: ["pending_customer", "pending_internal"] };
    const evaluation = evaluateCommitment(commitmentFor("first_response"), events, broadPolicy, alwaysOpen, at("11:00"));
    expect(evaluation).toMatchObject({ elapsedWorkingMinutes: 60, clock: { state: "running" } });
  });
});

describe("findFirstResponseEvent", () => {
  it("returns the earliest agent reply at or before asOf", () => {
    const first = event("11:00", "agent_replied", null);
    const second = event("12:00", "agent_replied", null);
    const events = [event("10:00", "case_created", "open"), second, first];
    expect(findFirstResponseEvent(events, at("12:30"))).toBe(first);
    expect(findFirstResponseEvent(events, at("10:59"))).toBeNull();
  });

  it("completes at the close when the case closed before any agent replied", () => {
    const solved = event("11:00", "case_closed", "resolved");
    const events = [event("10:00", "case_created", "open"), solved, event("12:00", "agent_replied", null)];
    expect(findFirstResponseEvent(events, at("13:00"))).toBe(solved);
  });

  it("prefers a same-instant agent reply over its paired close (reply and close, D5)", () => {
    const close = event("11:00", "case_closed", "resolved", { sourceSequence: 1 });
    const reply = event("11:00", "agent_replied", null, { sourceSequence: 2 });
    // Source order lists the transition first (matching how the normalizers
    // emit a "reply and close"), but the reply must still win.
    expect(findFirstResponseEvent([event("10:00", "case_created", "open"), close, reply], at("12:00"))).toBe(reply);
  });

  it("stays complete after the case is reopened", () => {
    const reply = event("11:00", "agent_replied", null);
    const events = [
      event("10:00", "case_created", "open"),
      reply,
      event("12:00", "case_closed", "resolved"),
      event("13:00", "state_changed", "open", { actor: "customer" }),
    ];
    expect(findFirstResponseEvent(events, at("14:00"))).toBe(reply);
    // Resolution, in contrast, is open again.
    expect(findCompletionEvent("resolution", events, at("14:00"))).toBeNull();
  });

  it("ignores activity on a linked engineering issue", () => {
    const events = [
      event("10:00", "case_created", "open"),
      event("11:00", "agent_replied", null, { system: "jira" }),
      event("11:30", "state_changed", "resolved", { system: "jira" }),
    ];
    expect(findFirstResponseEvent(events, at("12:00"))).toBeNull();
  });
});

describe("customer replies", () => {
  const withCustomerReplies: NormalizedEvent[] = [
    event("10:00", "case_created", "new", { actor: "customer" }),
    event("10:30", "customer_replied", null, { actor: "customer" }),
    event("11:00", "customer_replied", null, { actor: "customer" }),
  ];

  it("do not complete a first-response or resolution commitment", () => {
    expect(findFirstResponseEvent(withCustomerReplies, at("12:00"))).toBeNull();
    expect(findCompletionEvent("first_response", withCustomerReplies, at("12:00"))).toBeNull();
    expect(findCompletionEvent("resolution", withCustomerReplies, at("12:00"))).toBeNull();
  });

  it("do not change elapsed time or clock state", () => {
    const withoutReplies = withCustomerReplies.filter((e) => e.type !== "customer_replied");
    for (const kind of ["first_response", "resolution"] as const) {
      const a = evaluate(kind, withCustomerReplies, "12:00");
      const b = evaluate(kind, withoutReplies, "12:00");
      expect(a.elapsedSeconds).toBe(b.elapsedSeconds);
      expect(a.status).toBe(b.status);
      expect(a.clock).toEqual(b.clock);
    }
  });

  it("leave first response completed by the later agent reply", () => {
    const reply = event("12:00", "agent_replied", null);
    expect(findFirstResponseEvent([...withCustomerReplies, reply], at("13:00"))).toBe(reply);
  });
});

describe("resolveFirstResponseStartedAt (D5b)", () => {
  it("starts at ticket creation for a customer-created ticket", () => {
    const events = [event("10:00", "case_created", "new", { actor: "customer" })];
    expect(resolveFirstResponseStartedAt(events, at("10:00"))).toBe(at("10:00"));
  });

  it("starts at the first customer reply for an agent-created ticket", () => {
    const events = [
      event("10:00", "case_created", "new", { actor: "agent" }),
      event("11:00", "customer_replied", null, { actor: "customer" }),
    ];
    expect(resolveFirstResponseStartedAt(events, at("10:00"))).toBe(at("11:00"));
  });

  it("returns null for an agent-created ticket with no customer reply yet", () => {
    const events = [event("10:00", "case_created", "new", { actor: "agent" })];
    expect(resolveFirstResponseStartedAt(events, at("10:00"))).toBeNull();
  });

  it("ignores a customer reply from a linked engineering issue", () => {
    const events = [
      event("10:00", "case_created", "new", { actor: "agent" }),
      event("11:00", "customer_replied", null, { actor: "customer", system: "jira" }),
    ];
    expect(resolveFirstResponseStartedAt(events, at("10:00"))).toBeNull();
  });

  it("falls back to caseCreatedAt when no case_created event exists (pre-existing rows)", () => {
    expect(resolveFirstResponseStartedAt([], at("10:00"))).toBe(at("10:00"));
  });
});

describe("evaluateCommitment respects the D5b-delayed clock start", () => {
  // Agent-created ticket: an agent reply before the customer ever wrote
  // anything, then the customer's first message. Per D5b the commitment's
  // clock starts at 11:00, not ticket creation.
  const preClockEvents: NormalizedEvent[] = [
    event("10:00", "case_created", "new"),
    event("10:15", "agent_replied", null),
    event("11:00", "customer_replied", null, { actor: "customer" }),
  ];
  const delayedCommitment = () =>
    createCommitment("case-1", "first_response", at("11:00"), policy, alwaysOpen);

  it("does not treat an agent reply from before the clock started as completing the commitment", () => {
    const evaluation = evaluateCommitment(delayedCommitment(), preClockEvents, policy, alwaysOpen, at("11:15"));
    expect(evaluation).toMatchObject({
      status: "on_track",
      elapsedWorkingMinutes: 15,
      clock: { state: "running" },
    });
  });

  it("completes normally on the first agent reply that actually follows the customer's message", () => {
    const events = [...preClockEvents, event("11:20", "agent_replied", null)];
    const evaluation = evaluateCommitment(delayedCommitment(), events, policy, alwaysOpen, at("11:25"));
    expect(evaluation).toMatchObject({
      status: "met",
      elapsedWorkingMinutes: 20,
      clock: { state: "stopped" },
    });
  });

  it("still finds the pre-clock reply when no startedAt bound is given (Next Reply cycle derivation)", () => {
    // findFirstResponseEvent is also used, unbounded, to split first-response
    // from next-reply cycles (evaluate.ts's findNextReplyCompletionEvent,
    // cycle-pipeline.ts) — that usage must keep seeing the ticket's actual
    // first reply, regardless of this commitment's own D5b-delayed window.
    expect(findFirstResponseEvent(preClockEvents, at("11:15"))?.type).toBe("agent_replied");
    expect(findFirstResponseEvent(preClockEvents, at("11:15"))?.occurredAt).toBe(at("10:15"));
  });
});
