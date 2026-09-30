import { withSourceRole } from "./source-role";
import { describe, expect, it } from "vitest";
import { computeElapsedWorkingMinutes } from "../src/elapsed.js";
import { computeBreachedAt, evaluateCommitment } from "../src/evaluate.js";
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

// Mon–Fri 09:00–17:00 in New York, which switches to EDT on Sun 2026-03-08.
const newYorkBusinessHours: BusinessCalendarVersion = {
  id: "cal-ny",
  version: 1,
  timezone: "America/New_York",
  weekly: [1, 2, 3, 4, 5].map((day) => ({ day: day as 1, openMinute: 540, closeMinute: 1020 })),
  holidays: [],
  alwaysOpen: false,
};

function policyFor(calendar: BusinessCalendarVersion): SLAPolicyVersion {
  return {
    id: "policy-v1",
    policyId: "policy",
    version: 1,
    match: {},
    targets: [
      { kind: "first_response", minutes: 60 },
      { kind: "resolution", minutes: 60 },
    ],
    pauseOnStates: ["pending_customer"],
    calendarVersionId: calendar.id,
    warnAtPercent: [50, 80, 95],
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  };
}

// Resolution: the breach instant follows its pause-aware clock. First
// response never pauses (clock-rules.ts), covered at the end of this file.
function commitmentAt(
  startedAt: string,
  targetMinutes = 60,
  calendar = alwaysOpen,
  kind: Commitment["kind"] = "resolution",
): Commitment {
  return {
    id: "commitment-1",
    caseId: "case-1",
    kind,
    policyVersionId: "policy-v1",
    calendarVersionId: calendar.id,
    startedAt,
    targetMinutes,
    dueAt: startedAt, // deliberately wrong: computeBreachedAt must not read it
    status: "on_track",
  };
}

let seq = 0;
function event(
  occurredAt: string,
  partial: Pick<NormalizedEvent, "type" | "toState"> & Partial<NormalizedEvent>,
): NormalizedEvent {
  seq += 1;
  return withSourceRole({
    id: `evt-${seq}`,
    caseId: "case-1",
    occurredAt,
    actor: "agent",
    system: "zendesk",
    fromState: null,
    sourceRawEventId: `raw-${seq}`,
    ...partial,
  });
}

const created = (at: string) => event(at, { type: "case_created", toState: "open", actor: "customer" });
const closed = (at: string) => event(at, { type: "case_closed", fromState: "open", toState: "resolved" });
const autoClosed = (at: string) =>
  event(at, { type: "case_closed", fromState: "resolved", toState: "closed", actor: "system" });
const jira = (at: string, fromState: NormalizedEvent["fromState"], toState: NormalizedEvent["toState"]) =>
  event(at, { type: "state_changed", system: "jira", fromState, toState });

describe("computeBreachedAt", () => {
  it("returns the historical crossing instant even when first evaluated days later", () => {
    const commitment = commitmentAt("2026-09-10T01:44:00.000Z");
    const events = [created("2026-09-10T01:44:00.000Z")];

    expect(
      computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, "2026-09-16T23:14:25.556Z"),
    ).toBe("2026-09-10T02:44:00.000Z");
  });

  it("gives the same instant however many times and however late it is re-evaluated", () => {
    const commitment = commitmentAt("2026-09-10T01:44:00.000Z");
    const events = [created("2026-09-10T01:44:00.000Z")];
    const asOfs = [
      "2026-09-10T02:44:00.000Z",
      "2026-09-10T03:00:00.000Z",
      "2026-09-16T23:14:25.556Z",
      "2026-09-17T08:00:00.000Z",
      "2026-12-31T00:00:00.000Z",
    ];

    const results = asOfs.map((asOf) =>
      computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, asOf),
    );
    expect(new Set(results)).toEqual(new Set(["2026-09-10T02:44:00.000Z"]));
  });

  it("keeps a closed case's breach on the breach instant, not the close", () => {
    const commitment = commitmentAt("2026-09-10T01:44:00.000Z");
    const events = [created("2026-09-10T01:44:00.000Z"), closed("2026-09-16T02:21:00.000Z")];

    expect(
      computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, "2026-09-17T00:00:00.000Z"),
    ).toBe("2026-09-10T02:44:00.000Z");
  });

  it("returns null for a commitment that was met", () => {
    const commitment = commitmentAt("2026-09-10T01:44:00.000Z");
    const closedInside = [created("2026-09-10T01:44:00.000Z"), closed("2026-09-10T02:30:00.000Z")];
    const closedExactlyAtTarget = [created("2026-09-10T01:44:00.000Z"), closed("2026-09-10T02:44:00.000Z")];

    for (const events of [closedInside, closedExactlyAtTarget]) {
      const asOf = "2026-09-17T00:00:00.000Z";
      expect(evaluateCommitment(commitment, events, policyFor(alwaysOpen), alwaysOpen, asOf).status).toBe("met");
      expect(computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, asOf)).toBeNull();
    }
  });

  it("returns null before the deadline and the deadline itself once an open commitment reaches it", () => {
    const commitment = commitmentAt("2026-09-10T01:44:00.000Z");
    const events = [created("2026-09-10T01:44:00.000Z")];
    const policy = policyFor(alwaysOpen);

    expect(computeBreachedAt(commitment, events, policy, alwaysOpen, "2026-09-10T02:43:59.000Z")).toBeNull();
    expect(computeBreachedAt(commitment, events, policy, alwaysOpen, "2026-09-10T02:44:00.000Z")).toBe(
      "2026-09-10T02:44:00.000Z",
    );
  });

  it("pushes the breach out by the time the clock was paused on the customer", () => {
    // Running 09:00–09:30 (30m), paused 09:30–10:30, running again: the
    // remaining 30m run out at 11:00, not at the unpaused 10:00.
    const commitment = commitmentAt("2026-09-10T09:00:00.000Z");
    const events = [
      created("2026-09-10T09:00:00.000Z"),
      event("2026-09-10T09:30:00.000Z", { type: "state_changed", fromState: "open", toState: "pending_customer" }),
      event("2026-09-10T10:30:00.000Z", { type: "state_changed", fromState: "pending_customer", toState: "open", actor: "customer" }),
    ];

    expect(
      computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, "2026-09-16T00:00:00.000Z"),
    ).toBe("2026-09-10T11:00:00.000Z");
  });

  it("never breaches while paused, even long past the unpaused deadline", () => {
    const commitment = commitmentAt("2026-09-10T09:00:00.000Z");
    const events = [
      created("2026-09-10T09:00:00.000Z"),
      event("2026-09-10T09:30:00.000Z", { type: "state_changed", fromState: "open", toState: "pending_customer" }),
    ];

    expect(
      computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, "2026-09-16T00:00:00.000Z"),
    ).toBeNull();
  });

  it("follows the business calendar across a weekend and a DST change", () => {
    // Fri 2026-03-06 16:30 EST (21:30Z): 30 working minutes left that day,
    // the other 30 run out Mon 2026-03-09 09:30 EDT (13:30Z).
    const commitment = commitmentAt("2026-03-06T21:30:00.000Z", 60, newYorkBusinessHours);
    const events = [created("2026-03-06T21:30:00.000Z")];

    expect(
      computeBreachedAt(
        commitment,
        events,
        policyFor(newYorkBusinessHours),
        newYorkBusinessHours,
        "2026-03-12T00:00:00.000Z",
      ),
    ).toBe("2026-03-09T13:30:00.000Z");
  });

  it("returns an instant at which exactly the target has elapsed on the SLA clock", () => {
    const commitment = commitmentAt("2026-03-06T20:00:00.000Z", 150, newYorkBusinessHours);
    const events = [
      created("2026-03-06T20:00:00.000Z"),
      event("2026-03-06T21:00:00.000Z", { type: "state_changed", fromState: "open", toState: "pending_customer" }),
      event("2026-03-09T14:00:00.000Z", { type: "state_changed", fromState: "pending_customer", toState: "open", actor: "customer" }),
    ];
    const policy = policyFor(newYorkBusinessHours);

    const breachedAt = computeBreachedAt(commitment, events, policy, newYorkBusinessHours, "2026-03-20T00:00:00.000Z");
    expect(breachedAt).not.toBeNull();
    const elapsed = computeElapsedWorkingMinutes(events, policy.pauseOnStates, newYorkBusinessHours, {
      start: commitment.startedAt,
      end: breachedAt!,
    });
    expect(elapsed.elapsedWorkingMinutes).toBe(150);
    const aMinuteEarlier = new Date(new Date(breachedAt!).getTime() - 60_000);
    expect(
      computeElapsedWorkingMinutes(events, policy.pauseOnStates, newYorkBusinessHours, {
        start: commitment.startedAt,
        end: aMinuteEarlier.toISOString(),
      })
        .elapsedWorkingMinutes,
    ).toBe(149);
  });

  it("returns null for a ticket solved inside target and auto-closed days later", () => {
    const commitment = commitmentAt("2026-09-10T01:44:00.000Z");
    const events = [
      created("2026-09-10T01:44:00.000Z"),
      closed("2026-09-10T02:30:00.000Z"),
      autoClosed("2026-09-14T02:30:00.000Z"),
    ];
    const asOf = "2026-09-17T00:00:00.000Z";

    expect(evaluateCommitment(commitment, events, policyFor(alwaysOpen), alwaysOpen, asOf).status).toBe("met");
    expect(computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, asOf)).toBeNull();
  });

  it("keeps the breach instant for a ticket solved past target and auto-closed later", () => {
    const commitment = commitmentAt("2026-09-10T01:44:00.000Z");
    const events = [
      created("2026-09-10T01:44:00.000Z"),
      closed("2026-09-10T03:00:00.000Z"),
      autoClosed("2026-09-14T03:00:00.000Z"),
    ];
    const asOf = "2026-09-17T00:00:00.000Z";

    const evaluation = evaluateCommitment(commitment, events, policyFor(alwaysOpen), alwaysOpen, asOf);
    expect(evaluation.status).toBe("breached");
    expect(evaluation.breachedByMinutes).toBe(16); // clock stopped at the solve, not the auto-close
    expect(computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, asOf)).toBe(
      "2026-09-10T02:44:00.000Z",
    );
  });

  it("ignores Jira transitions while a Zendesk customer pause is in effect", () => {
    // Running 09:00–09:30, Zendesk pending 09:30–12:00 (Jira moves to
    // in_progress at 10:00 and resolved at 11:00, which must not unpause),
    // running again from 12:00: the remaining 30m run out at 12:30.
    const commitment = commitmentAt("2026-09-10T09:00:00.000Z");
    const events = [
      created("2026-09-10T09:00:00.000Z"),
      event("2026-09-10T09:30:00.000Z", { type: "state_changed", fromState: "open", toState: "pending_customer" }),
      jira("2026-09-10T10:00:00.000Z", "new", "in_progress"),
      jira("2026-09-10T11:00:00.000Z", "in_progress", "resolved"),
      event("2026-09-10T12:00:00.000Z", { type: "state_changed", fromState: "pending_customer", toState: "open", actor: "customer" }),
    ];
    const policy = policyFor(alwaysOpen);
    const asOf = "2026-09-16T00:00:00.000Z";

    const breachedAt = computeBreachedAt(commitment, events, policy, alwaysOpen, asOf);
    expect(breachedAt).toBe("2026-09-10T12:30:00.000Z");
    expect(
      computeElapsedWorkingMinutes(events, policy.pauseOnStates, alwaysOpen, { start: commitment.startedAt, end: breachedAt! })
        .elapsedWorkingMinutes,
    ).toBe(60);
  });

  it("returns null for a Zendesk-paused ticket solved and auto-closed while Jira kept moving", () => {
    const commitment = commitmentAt("2026-09-10T09:00:00.000Z");
    const events = [
      created("2026-09-10T09:00:00.000Z"),
      event("2026-09-10T09:10:00.000Z", { type: "state_changed", fromState: "open", toState: "pending_customer" }),
      jira("2026-09-10T11:00:00.000Z", "resolved", "in_progress"),
      event("2026-09-10T11:05:00.000Z", { type: "case_closed", fromState: "pending_customer", toState: "resolved" }),
      autoClosed("2026-09-14T11:05:00.000Z"),
    ];
    const policy = policyFor(alwaysOpen);
    const asOf = "2026-09-17T00:00:00.000Z";

    const evaluation = evaluateCommitment(commitment, events, policy, alwaysOpen, asOf);
    expect(evaluation.status).toBe("met");
    expect(evaluation.elapsedWorkingMinutes).toBe(10);
    expect(computeBreachedAt(commitment, events, policy, alwaysOpen, asOf)).toBeNull();
  });

  it("does not push a first-response breach out for a customer pause", () => {
    const commitment = commitmentAt("2026-09-10T09:00:00.000Z", 60, alwaysOpen, "first_response");
    const events = [
      created("2026-09-10T09:00:00.000Z"),
      event("2026-09-10T09:30:00.000Z", { type: "state_changed", fromState: "open", toState: "pending_customer" }),
      event("2026-09-10T10:30:00.000Z", { type: "state_changed", fromState: "pending_customer", toState: "open", actor: "customer" }),
    ];

    expect(
      computeBreachedAt(commitment, events, policyFor(alwaysOpen), alwaysOpen, "2026-09-16T00:00:00.000Z"),
    ).toBe("2026-09-10T10:00:00.000Z");
  });
});
