/**
 * N1.3 — provider-neutral golden scenarios (V13). Pure engine tests: no DB,
 * no provider fixtures, no raw provider payloads. Each scenario is a
 * hand-computed event history run through `@sla/core` only.
 *
 * The seven scenarios are roadmap 7.10's (normal -> high, high -> normal,
 * breached then target increase, Next Reply cycles, Resolution pause and
 * resume, reopen, calendar change), followed by three the provider-neutral
 * work adds: two trackers on one case, a tracker `resolved` that must not
 * stop Resolution, and same-instant ordering between ticket source and
 * tracker. The pipeline-level counterparts (real Postgres, real Zendesk
 * payloads) stay in apps/web/test/sla-golden-scenarios.test.ts and
 * commitment-re-resolution.test.ts.
 *
 * `ticketEvent`, `trackerEvent` and `codeHostEvent` are the ONLY place a
 * source identity is set. They emit `sourceRole` (N1.5) plus a `system` string;
 * once N1.6-N1.8 land, `system` becomes an opaque value such as "ticket-a". The scenario
 * bodies below must not change when that happens — that is the point.
 */
import { describe, expect, it } from "vitest";
import {
  createCommitment,
  deriveLegSpans,
  deriveNextReplyCycles,
  evaluateCommitment,
  findFirstResponseEvent,
  matchPolicyVersion,
  resolveCommitmentPolicyChange,
  sortNormalizedEvents,
  sumLegMinutes,
  type BusinessCalendarVersion,
  type CaseAttributes,
  type Commitment,
  type CommitmentKind,
  type NormalizedEvent,
  type NormalizedEventType,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
} from "../src";

// ---- Source identity: the only place it is set --------------------------------

type TrackerId = "a" | "b";

const TICKET_SYSTEM = "zendesk" as const;
const TRACKER_SYSTEMS = { a: "jira", b: "linear" } as const;
const CODE_HOST_SYSTEM = "github" as const;

interface EventOptions {
  type: NormalizedEventType;
  at: string;
  actor?: NormalizedEvent["actor"];
  fromState?: NormalizedEvent["fromState"];
  toState?: NormalizedEvent["toState"];
  sourceSequence?: number;
}

let seq = 0;
function build(
  system: NormalizedEvent["system"],
  sourceRole: NormalizedEvent["sourceRole"],
  options: EventOptions,
): NormalizedEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    caseId: CASE_ID,
    type: options.type,
    occurredAt: at(options.at),
    actor: options.actor ?? "agent",
    system,
    sourceRole,
    fromState: options.fromState ?? null,
    toState: options.toState ?? null,
    sourceRawEventId: `raw-${seq}`,
    sourceSequence: options.sourceSequence ?? 0,
  };
}

const ticketEvent = (options: EventOptions) => build(TICKET_SYSTEM, "ticket_source", options);
const trackerEvent = (options: EventOptions & { tracker?: TrackerId }) =>
  build(TRACKER_SYSTEMS[options.tracker ?? "a"], "work_tracker", options);
const codeHostEvent = (options: EventOptions) => build(CODE_HOST_SYSTEM, "code_host", options);

// ---- Fixtures ----------------------------------------------------------------

const CASE_ID = "case-1";
const at = (time: string, day = "2026-09-17") => `${day}T${time}:00.000Z`;

const calendar24x7: BusinessCalendarVersion = {
  id: "cal-24x7",
  version: 1,
  timezone: "UTC",
  weekly: [],
  holidays: [],
  alwaysOpen: true,
};

/** Thursday and Friday, 09:00-17:00 UTC (2026-09-17 is a Thursday; day 0 = Sunday). */
const calendarThuFri: BusinessCalendarVersion = {
  id: "cal-thu-fri",
  version: 2,
  timezone: "UTC",
  weekly: ([4, 5] as const).map((day) => ({ day, openMinute: 9 * 60, closeMinute: 17 * 60 })),
  holidays: [],
  alwaysOpen: false,
};

function policy(
  id: string,
  policyId: string,
  targets: { kind: CommitmentKind; minutes: number }[],
  overrides: Partial<SLAPolicyVersion> & { match?: SLAPolicyMatch } = {},
): SLAPolicyVersion {
  return {
    id,
    policyId,
    version: 1,
    match: {},
    targets,
    pauseOnStates: [],
    calendarVersionId: calendar24x7.id,
    warnAtPercent: [50, 80, 95],
    effectiveFrom: at("00:00"),
    ...overrides,
  };
}

const caseWith = (priority?: string): CaseAttributes => ({ caseId: CASE_ID, attributes: {}, priority });

const evaluate = (
  commitment: Commitment,
  events: NormalizedEvent[],
  policyVersion: SLAPolicyVersion,
  asOf: string,
  calendar: BusinessCalendarVersion = calendar24x7,
) => evaluateCommitment(commitment, events, policyVersion, calendar, asOf);

/**
 * What Active-Commitment Re-Resolution does when a different policy now
 * matches: repoint policy, target, calendar and due date in place, keeping
 * the commitment's identity and `startedAt`.
 */
function reResolve(
  commitment: Commitment,
  currentPolicyId: string,
  matched: SLAPolicyVersion,
  calendar: BusinessCalendarVersion = calendar24x7,
): Commitment {
  const { changed, hasTarget } = resolveCommitmentPolicyChange(commitment, currentPolicyId, matched);
  if (!changed || !hasTarget) return commitment;
  return {
    ...createCommitment(commitment.caseId, commitment.kind, commitment.startedAt, matched, calendar, commitment.cycleKey),
    id: commitment.id,
  };
}

const caseOpened = () => ticketEvent({ type: "case_created", at: "09:00", actor: "customer", toState: "open" });

// ---- 1-2: priority changes re-resolve an active commitment ----------------------

describe("golden: priority change re-resolves an active commitment", () => {
  const normal = policy("pv-normal", "pol-normal", [{ kind: "resolution", minutes: 240 }], {
    match: { priority: ["normal"] },
  });
  const high = policy("pv-high", "pol-high", [{ kind: "resolution", minutes: 90 }], {
    match: { priority: ["high"] },
  });

  it("normal -> high: the tighter target applies at once, to the whole elapsed window", () => {
    const events = [caseOpened()];
    const original = createCommitment(CASE_ID, "resolution", at("09:00"), normal, calendar24x7);
    expect(matchPolicyVersion(caseWith("normal"), [normal, high])?.id).toBe("pv-normal");
    expect(original.dueAt).toBe(at("13:00"));

    // 10:00: priority becomes high. 60 of 240 minutes is 25%: on track.
    expect(evaluate(original, events, normal, at("10:00")).status).toBe("on_track");
    const matched = matchPolicyVersion(caseWith("high"), [normal, high])!;
    expect(matched.id).toBe("pv-high");
    const resolved = reResolve(original, "pol-normal", matched);

    // Same commitment, same start; only the target moved. Due 09:00 + 90m.
    expect(resolved).toMatchObject({ id: original.id, startedAt: at("09:00"), targetMinutes: 90, dueAt: at("10:30") });
    // The 60 minutes already elapsed now count against 90: 66.7% crosses the 50% warn line.
    const atChange = evaluate(resolved, events, high, at("10:00"));
    expect(atChange).toMatchObject({ status: "at_risk", warnThresholdCrossed: 50, elapsedSeconds: 60 * 60 });
    expect(atChange.remainingMinutes).toBe(30);

    // 10:45 is 105m elapsed: past 90m, breached since 10:30. Under the old target it would still be fine.
    const later = evaluate(resolved, events, high, at("10:45"));
    expect(later).toMatchObject({ status: "breached", effectiveDueAt: at("10:30"), breachedByMinutes: 15 });
    expect(evaluate(original, events, normal, at("10:45")).status).toBe("on_track");
  });

  it("high -> normal: the looser target applies at once", () => {
    const events = [caseOpened()];
    const original = createCommitment(CASE_ID, "resolution", at("09:00"), high, calendar24x7);
    expect(original.dueAt).toBe(at("10:30"));
    // 60 of 90 minutes: at risk before the downgrade.
    expect(evaluate(original, events, high, at("10:00")).status).toBe("at_risk");

    const matched = matchPolicyVersion(caseWith("normal"), [normal, high])!;
    const resolved = reResolve(original, "pol-high", matched);

    expect(resolved).toMatchObject({ id: original.id, startedAt: at("09:00"), targetMinutes: 240, dueAt: at("13:00") });
    // 60 of 240 minutes: 25%, back on track with 180 minutes left.
    const after = evaluate(resolved, events, normal, at("10:00"));
    expect(after.status).toBe("on_track");
    expect(after.remainingMinutes).toBe(180);
    expect(after.warnThresholdCrossed).toBeUndefined();
  });
});

// ---- 3: breached, then the target increases -----------------------------------

describe("golden: breached, then the target increases", () => {
  it("a new version of the same policy never re-resolves; the breach and its instant stay put", () => {
    const v1 = policy("pv-a-1", "pol-a", [{ kind: "resolution", minutes: 60 }]);
    const v2 = policy("pv-a-2", "pol-a", [{ kind: "resolution", minutes: 240 }], { version: 2 });
    const events = [caseOpened()];
    const commitment = createCommitment(CASE_ID, "resolution", at("09:00"), v1, calendar24x7);

    const breached = evaluate(commitment, events, v1, at("10:30"));
    expect(breached).toMatchObject({ status: "breached", effectiveDueAt: at("10:00"), breachedByMinutes: 30 });

    // The policy target is then raised to 240m (a new version of the SAME policy, D1).
    const matched = matchPolicyVersion(caseWith(), [v2])!;
    expect(matched.id).toBe("pv-a-2");
    expect(resolveCommitmentPolicyChange(commitment, "pol-a", matched)).toEqual({ changed: false, hasTarget: true });
    expect(reResolve(commitment, "pol-a", matched)).toBe(commitment);

    // Still frozen on the version it breached under: same breach instant, larger overrun.
    const later = evaluate(commitment, events, v1, at("12:00"));
    expect(later).toMatchObject({ status: "breached", effectiveDueAt: at("10:00"), breachedByMinutes: 120 });
  });
});

// ---- 4: Next Reply cycles ------------------------------------------------------

describe("golden: Next Reply cycles", () => {
  it("several customer messages are one cycle; extra agent replies create nothing; a new message starts the next", () => {
    const nextReply = policy("pv-nr", "pol-nr", [{ kind: "next_reply", minutes: 30 }]);
    const events = [
      caseOpened(),
      ticketEvent({ type: "agent_replied", at: "09:05" }), // first response: the gate for cycles
      ticketEvent({ type: "customer_replied", at: "10:00", actor: "customer" }),
      ticketEvent({ type: "customer_replied", at: "10:05", actor: "customer" }),
      ticketEvent({ type: "agent_replied", at: "10:20" }), // answers the open cycle
      ticketEvent({ type: "agent_replied", at: "10:25" }), // no cycle open: creates nothing
      ticketEvent({ type: "customer_replied", at: "11:00", actor: "customer" }),
    ];
    const asOf = at("11:10");
    const cycles = deriveNextReplyCycles(events, { asOf, firstResponseCompletion: findFirstResponseEvent(events, asOf) });

    expect(cycles.map((c) => [c.startedAt, c.completedAt, c.customerReplies.length])).toEqual([
      [at("10:00"), at("10:20"), 2],
      [at("11:00"), null, 1],
    ]);

    const [answered, open] = cycles.map((c) => createCommitment(CASE_ID, "next_reply", c.startedAt, nextReply, calendar24x7, c.key));
    expect(evaluate(answered!, events, nextReply, asOf)).toMatchObject({ status: "met", elapsedSeconds: 20 * 60 });
    const pending = evaluate(open!, events, nextReply, asOf);
    expect(pending).toMatchObject({ status: "on_track", elapsedSeconds: 10 * 60 });
    expect(pending.remainingMinutes).toBe(20);
  });
});

// ---- 5: Resolution pause and resume --------------------------------------------

describe("golden: Resolution pause and resume", () => {
  const events = [
    ticketEvent({ type: "case_created", at: "10:00", actor: "customer", toState: "open" }),
    ticketEvent({ type: "state_changed", at: "10:30", fromState: "open", toState: "pending_customer" }),
    ticketEvent({ type: "state_changed", at: "11:30", fromState: "pending_customer", toState: "open" }),
    ticketEvent({ type: "case_closed", at: "13:30", fromState: "open", toState: "resolved" }),
  ];

  it("time waiting on the customer is excluded from the running total", () => {
    const pausing = policy("pv-pause", "pol-pause", [{ kind: "resolution", minutes: 240 }], {
      pauseOnStates: ["pending_customer"],
    });
    const commitment = createCommitment(CASE_ID, "resolution", at("10:00"), pausing, calendar24x7);

    // Mid-pause at 11:00: 30 running minutes so far, clock paused since 10:30.
    const paused = evaluate(commitment, events, pausing, at("11:00"));
    expect(paused).toMatchObject({ status: "on_track", elapsedSeconds: 30 * 60 });
    expect(paused.clock).toEqual({ state: "paused", pausedSince: at("10:30"), pauseCause: "pending_customer" });

    // Solved at 13:30: 10:00-10:30 (30m) + 11:30-13:30 (120m) = 150m. The pending hour is not counted.
    const done = evaluate(commitment, events, pausing, at("13:30"));
    expect(done).toMatchObject({ status: "met", elapsedSeconds: 150 * 60 });
    expect(done.clock.state).toBe("stopped");
  });

  it("the same history under a policy that does not pause counts the whole wait", () => {
    const running = policy("pv-nopause", "pol-nopause", [{ kind: "resolution", minutes: 240 }]);
    const commitment = createCommitment(CASE_ID, "resolution", at("10:00"), running, calendar24x7);
    // 10:00-13:30, no pause: 210 minutes.
    expect(evaluate(commitment, events, running, at("13:30")).elapsedSeconds).toBe(210 * 60);
  });
});

// ---- 6: reopen -----------------------------------------------------------------

describe("golden: reopen", () => {
  const resolutionAndReply = policy("pv-reopen", "pol-reopen", [
    { kind: "resolution", minutes: 150 },
    { kind: "next_reply", minutes: 30 },
  ]);
  const events = [
    caseOpened(),
    ticketEvent({ type: "agent_replied", at: "09:05" }),
    ticketEvent({ type: "customer_replied", at: "10:05", actor: "customer" }), // opens a cycle
    ticketEvent({ type: "case_closed", at: "10:30", fromState: "open", toState: "resolved" }),
    ticketEvent({ type: "customer_replied", at: "11:30", actor: "customer" }), // reopens
    ticketEvent({ type: "state_changed", at: "11:30", fromState: "resolved", toState: "open" }),
    ticketEvent({ type: "agent_replied", at: "11:45" }),
    ticketEvent({ type: "case_closed", at: "12:00", fromState: "open", toState: "resolved" }),
  ];

  it("time spent solved is excluded from Resolution (D3)", () => {
    const commitment = createCommitment(CASE_ID, "resolution", at("09:00"), resolutionAndReply, calendar24x7);
    // 09:00-10:30 (90m) + 11:30-12:00 (30m) = 120m. Counting the solved hour would make it 180m and breach 150m.
    const done = evaluate(commitment, events, resolutionAndReply, at("12:10"));
    expect(done).toMatchObject({ status: "met", elapsedSeconds: 120 * 60 });
  });

  it("the close cancels the unanswered cycle; the reopen starts a fresh one", () => {
    const beforeClose = at("10:20");
    const early = deriveNextReplyCycles(events, {
      asOf: beforeClose,
      firstResponseCompletion: findFirstResponseEvent(events, beforeClose),
    });
    expect(early.map((c) => [c.startedAt, c.completedAt])).toEqual([[at("10:05"), null]]);

    const asOf = at("12:10");
    const cycles = deriveNextReplyCycles(events, { asOf, firstResponseCompletion: findFirstResponseEvent(events, asOf) });
    // The 10:05 cycle is dropped (cancelled, not completed); only the post-reopen cycle remains.
    expect(cycles.map((c) => [c.startedAt, c.completedAt])).toEqual([[at("11:30"), at("11:45")]]);
    expect(cycles[0]!.key).not.toBe(early[0]!.key);

    const commitment = createCommitment(CASE_ID, "next_reply", cycles[0]!.startedAt, resolutionAndReply, calendar24x7, cycles[0]!.key);
    expect(evaluate(commitment, events, resolutionAndReply, asOf)).toMatchObject({ status: "met", elapsedSeconds: 15 * 60 });
  });
});

// ---- 7: calendar change --------------------------------------------------------

describe("golden: calendar change", () => {
  const openedThursday4pm = () => [
    ticketEvent({ type: "case_created", at: "16:00", actor: "customer", toState: "open" }),
  ];

  it("D1b: a new calendar version never moves an active commitment; new commitments use it", () => {
    const onOldCalendar = policy("pv-cal-1", "pol-cal", [{ kind: "resolution", minutes: 120 }]);
    const onNewCalendar = policy("pv-cal-2", "pol-cal", [{ kind: "resolution", minutes: 120 }], {
      version: 2,
      calendarVersionId: calendarThuFri.id,
    });
    const events = openedThursday4pm();
    const existing = createCommitment(CASE_ID, "resolution", at("16:00"), onOldCalendar, calendar24x7);
    expect(existing.dueAt).toBe(at("18:00"));

    // Same policy, only its calendar changed: not a policy switch.
    const matched = matchPolicyVersion(caseWith(), [onNewCalendar])!;
    expect(resolveCommitmentPolicyChange(existing, "pol-cal", matched).changed).toBe(false);
    expect(reResolve(existing, "pol-cal", matched, calendarThuFri)).toBe(existing);
    // Still measured on the calendar it was created under: breached at 18:00.
    expect(evaluate(existing, events, onOldCalendar, at("18:30"))).toMatchObject({
      status: "breached",
      effectiveDueAt: at("18:00"),
    });

    // A commitment created after the change uses the new calendar:
    // Thu 16:00-17:00 (60m), closed overnight, Fri 09:00-10:00 (60m).
    const fresh = createCommitment(CASE_ID, "resolution", at("16:00"), onNewCalendar, calendarThuFri);
    expect(fresh.dueAt).toBe(at("10:00", "2026-09-18"));
  });

  it("a switch to a different policy re-prices the whole elapsed window on the new calendar", () => {
    const standard = policy("pv-std", "pol-std", [{ kind: "resolution", minutes: 120 }], { match: { priority: ["normal"] } });
    const business = policy("pv-biz", "pol-biz", [{ kind: "resolution", minutes: 120 }], {
      match: { priority: ["high"] },
      calendarVersionId: calendarThuFri.id,
    });
    const events = openedThursday4pm();
    const original = createCommitment(CASE_ID, "resolution", at("16:00"), standard, calendar24x7);
    // 90 wall-clock minutes at 17:30 on the 24/7 calendar.
    expect(evaluate(original, events, standard, at("17:30")).elapsedSeconds).toBe(90 * 60);

    const matched = matchPolicyVersion(caseWith("high"), [standard, business])!;
    const resolved = reResolve(original, "pol-std", matched, calendarThuFri);
    expect(resolved).toMatchObject({ id: original.id, startedAt: at("16:00"), calendarVersionId: "cal-thu-fri" });
    expect(resolved.dueAt).toBe(at("10:00", "2026-09-18"));
    // Only 16:00-17:00 was inside opening hours: 60 minutes, not 90.
    expect(evaluate(resolved, events, business, at("17:30"), calendarThuFri).elapsedSeconds).toBe(60 * 60);
  });
});

// ---- 8: two trackers on one case ------------------------------------------------

describe("golden: two trackers on one case", () => {
  it("is one engineering leg, however many issues are linked, ending when they resolve", () => {
    const events = [
      caseOpened(),
      trackerEvent({ tracker: "a", type: "issue_linked", at: "10:00" }),
      trackerEvent({ tracker: "b", type: "issue_linked", at: "10:30" }),
      trackerEvent({ tracker: "a", type: "state_changed", at: "11:00", fromState: "in_progress", toState: "resolved" }),
      trackerEvent({ tracker: "b", type: "state_changed", at: "11:00", fromState: "in_progress", toState: "resolved" }),
    ];
    const { spans, warnings } = deriveLegSpans(events);

    expect(warnings).toEqual([]);
    expect(spans.map((s) => [s.leg, s.confidence, s.startedAt, s.endedAt])).toEqual([
      ["support", "certain", at("09:00"), at("10:00")],
      ["engineering", "certain", at("10:00"), at("11:00")],
      ["support", "certain", at("11:00"), null],
    ]);
    // The second link refreshes the annotation; it does not split the span.
    expect(spans[1]!.note).toBe("2 linked issues — attributed as one engineering leg");
    expect(sumLegMinutes(spans, "engineering", at("12:00"))).toBe(60);
  });
});

// ---- 9: a tracker `resolved` must not stop Resolution ----------------------------

describe("golden: tracker resolved does not stop Resolution", () => {
  const resolution = policy("pv-res", "pol-res", [{ kind: "resolution", minutes: 240 }]);
  const commitment = createCommitment(CASE_ID, "resolution", at("09:00"), resolution, calendar24x7);

  it("a resolved tracker issue or code-host change leaves the clock running", () => {
    const events = [
      caseOpened(),
      trackerEvent({ type: "issue_linked", at: "09:30" }),
      trackerEvent({ type: "state_changed", at: "10:00", fromState: "in_progress", toState: "resolved" }),
      codeHostEvent({ type: "state_changed", at: "10:15", fromState: "in_progress", toState: "resolved" }),
    ];
    const result = evaluate(commitment, events, resolution, at("12:00"));

    // 09:00-12:00 is 180 of 240 minutes and still running: 75% is at risk, not met.
    expect(result.clock).toEqual({ state: "running", pausedSince: null, pauseCause: null });
    expect(result).toMatchObject({ status: "at_risk", elapsedSeconds: 180 * 60, warnThresholdCrossed: 50 });
  });

  it("only the ticket source solving the ticket stops it", () => {
    const events = [
      caseOpened(),
      trackerEvent({ type: "issue_linked", at: "09:30" }),
      trackerEvent({ type: "state_changed", at: "10:00", fromState: "in_progress", toState: "resolved" }),
      ticketEvent({ type: "case_closed", at: "10:20", fromState: "open", toState: "resolved" }),
    ];
    const result = evaluate(commitment, events, resolution, at("12:00"));
    expect(result).toMatchObject({ status: "met", elapsedSeconds: 80 * 60 });
    expect(result.clock.state).toBe("stopped");
  });
});

// ---- 10: same-instant ordering between ticket source and tracker ------------------

describe("golden: same-instant ordering between ticket source and tracker", () => {
  const resolution = policy("pv-order", "pol-order", [{ kind: "resolution", minutes: 240 }], {
    pauseOnStates: ["pending_customer"],
  });

  function history() {
    return [
      caseOpened(),
      trackerEvent({ type: "issue_linked", at: "09:30" }),
      // Same instant. The tracker's own sequence number is LOWER than the
      // ticket source's; sequences only compare within one source, so it
      // must not decide the order.
      trackerEvent({ type: "state_changed", at: "10:00", toState: "in_progress", sourceSequence: 0 }),
      ticketEvent({ type: "state_changed", at: "10:00", fromState: "open", toState: "pending_customer", sourceSequence: 7 }),
    ];
  }

  it("the ticket source sorts ahead of the tracker at the same instant, whatever the input order", () => {
    const forward = history();
    for (const input of [forward, [...forward].reverse()]) {
      const sorted = sortNormalizedEvents(input.filter((e) => e.occurredAt === at("10:00")));
      expect(sorted.map((e) => [e.system, e.toState])).toEqual([
        [TICKET_SYSTEM, "pending_customer"],
        [TRACKER_SYSTEMS.a, "in_progress"],
      ]);
    }
  });

  it("the derived legs and the evaluation do not depend on input order", () => {
    const forward = history();
    const reversed = [...forward].reverse();
    const commitment = createCommitment(CASE_ID, "resolution", at("09:00"), resolution, calendar24x7);

    expect(deriveLegSpans(reversed)).toEqual(deriveLegSpans(forward));
    const a = evaluate(commitment, forward, resolution, at("11:00"));
    const b = evaluate(commitment, reversed, resolution, at("11:00"));
    expect(b).toEqual(a);
    // Paused by the ticket source from 10:00: 60 running minutes.
    expect(a).toMatchObject({ elapsedSeconds: 60 * 60 });
    expect(a.clock).toMatchObject({ state: "paused", pauseCause: "pending_customer" });
  });
});
