import { describe, expect, it } from "vitest";
import { computeBreachedAt, evaluateCommitment, findCaseCloseEvent, findFirstResponseEvent } from "../src/evaluate";
import { foldClockIntervals } from "../src/elapsed";
import { deriveLegSpans } from "../src/legs";
import { compareNormalizedEvents, sortNormalizedEvents } from "../src/ordering";
import type {
  BusinessCalendarVersion,
  Commitment,
  CommitmentKind,
  NormalizedEvent,
  NormalizedEventType,
  NormalizedState,
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
  targets: [
    { kind: "first_response", minutes: 60 },
    { kind: "resolution", minutes: 600 },
  ],
  pauseOnStates: ["pending_customer"],
  calendarVersionId: alwaysOpen.id,
  warnAtPercent: [50, 80, 95],
  effectiveFrom: "2026-09-01T00:00:00.000Z",
};

const at = (time: string) => `2026-09-17T${time}:00.000Z`;
const AS_OF = at("12:00");

function event(
  id: string,
  time: string,
  type: NormalizedEventType,
  overrides: Partial<NormalizedEvent> & { fromState?: NormalizedState | null; toState?: NormalizedState | null } = {},
): NormalizedEvent {
  return {
    id,
    caseId: "case-1",
    type,
    occurredAt: at(time),
    actor: "agent",
    system: "zendesk",
    fromState: null,
    toState: null,
    sourceRawEventId: `raw-${id}`,
    ...overrides,
  };
}

function commitment(kind: CommitmentKind): Commitment {
  const target = policy.targets.find((t) => t.kind === kind)!.minutes;
  return {
    id: `commitment-${kind}`,
    caseId: "case-1",
    kind,
    policyVersionId: policy.id,
    calendarVersionId: alwaysOpen.id,
    startedAt: at("08:00"),
    targetMinutes: target,
    dueAt: at("09:00"),
    status: "on_track",
  };
}

/** Deterministic PRNG (mulberry32) so shuffles are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/** Every observable output of the engine for one event list. */
function engineSnapshot(events: NormalizedEvent[]) {
  return {
    firstResponse: evaluateCommitment(commitment("first_response"), events, policy, alwaysOpen, AS_OF),
    resolution: evaluateCommitment(commitment("resolution"), events, policy, alwaysOpen, AS_OF),
    firstResponseBreachedAt: computeBreachedAt(commitment("first_response"), events, policy, alwaysOpen, AS_OF),
    firstResponseEvent: findFirstResponseEvent(events, AS_OF)?.id ?? null,
    caseCloseEvent: findCaseCloseEvent(events, AS_OF)?.id ?? null,
    fold: foldClockIntervals(events, policy.pauseOnStates, { start: at("08:00"), end: AS_OF }),
    legs: deriveLegSpans(events),
  };
}

describe("compareNormalizedEvents", () => {
  it("orders by occurredAt first, regardless of sequence", () => {
    const later = event("a", "09:00", "agent_replied", { sourceSequence: 1 });
    const earlier = event("b", "08:00", "agent_replied", { sourceSequence: 99 });
    expect(sortNormalizedEvents([later, earlier]).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("compares instants, not strings, so equivalent ISO spellings tie on time", () => {
    const withMillis = event("a", "09:00", "agent_replied", { sourceSequence: 2 });
    const withoutMillis = { ...event("b", "09:00", "state_changed", { sourceSequence: 1 }), occurredAt: "2026-09-17T09:00:00Z" };
    expect(sortNormalizedEvents([withMillis, withoutMillis]).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("breaks a same-instant tie by sourceSequence within a system", () => {
    const status = event("status", "09:00", "case_closed", { toState: "resolved", sourceSequence: 2 });
    const reply = event("reply", "09:00", "agent_replied", { sourceSequence: 1 });
    expect(sortNormalizedEvents([status, reply]).map((e) => e.id)).toEqual(["reply", "status"]);
    expect(sortNormalizedEvents([reply, status]).map((e) => e.id)).toEqual(["reply", "status"]);
  });

  it("ranks systems before comparing sequences, since each system numbers its own", () => {
    const systems: string[] = ["github", "linear", "jira", "intercom", "zendesk"];
    const events = systems.map((system, i) =>
      event(system, "09:00", "state_changed", { system, toState: "open", sourceSequence: i }),
    );
    expect(sortNormalizedEvents(events).map((e) => e.system)).toEqual(["zendesk", "intercom", "jira", "linear", "github"]);
  });

  it("orders legacy rows without a sequence deterministically by content, never by id", () => {
    const a = event("zzz", "09:00", "state_changed", { toState: "open", sourceRawEventId: "raw-1" });
    const b = event("aaa", "09:00", "agent_replied", { sourceRawEventId: "raw-2" });
    const c = event("mmm", "09:00", "case_closed", { toState: "resolved", sourceRawEventId: "raw-1" });
    const expected = ["mmm", "zzz", "aaa"];
    for (const order of permutations([a, b, c])) {
      expect(sortNormalizedEvents(order).map((e) => e.id)).toEqual(expected);
    }
    // Regenerated ids (normalization rewrites rows) don't change the order.
    const renamed = [a, b, c].map((e, i) => ({ ...e, id: `new-${i}` }));
    expect(sortNormalizedEvents(renamed).map((e) => e.sourceRawEventId + e.type)).toEqual([
      "raw-1case_closed",
      "raw-1state_changed",
      "raw-2agent_replied",
    ]);
  });

  it("treats a missing sequence as 0", () => {
    const legacy = event("legacy", "09:00", "state_changed", { toState: "open", sourceRawEventId: "raw-z" });
    const sequenced = event("sequenced", "09:00", "state_changed", { toState: "open", sourceRawEventId: "raw-a", sourceSequence: 1 });
    expect(sortNormalizedEvents([sequenced, legacy]).map((e) => e.id)).toEqual(["legacy", "sequenced"]);
  });

  it("is a consistent total order: antisymmetric, and 0 only for identical content", () => {
    const events = [
      event("1", "09:00", "agent_replied", { sourceSequence: 1 }),
      event("2", "09:00", "case_closed", { toState: "resolved", sourceSequence: 2 }),
      event("3", "09:00", "state_changed", { system: "jira", toState: "in_progress", sourceSequence: 0 }),
      event("4", "08:59", "case_created", { toState: "open", sourceSequence: 0 }),
      event("5", "09:00", "state_changed", { toState: "open" }),
    ];
    for (const x of events) {
      for (const y of events) {
        expect(Math.sign(compareNormalizedEvents(x, y)) + Math.sign(compareNormalizedEvents(y, x))).toBe(0);
        if (x !== y) expect(compareNormalizedEvents(x, y)).not.toBe(0);
      }
    }
  });
});

describe("engine determinism under same-timestamp events", () => {
  it("a reply and a solve in the same audit evaluate identically in either input order (id included)", () => {
    const events = [
      event("created", "08:00", "case_created", { toState: "open", sourceSequence: 0 }),
      event("reply", "08:30", "agent_replied", { sourceSequence: 1 }),
      event("solve", "08:30", "case_closed", { fromState: "open", toState: "resolved", sourceSequence: 2 }),
    ];
    const snapshots = permutations(events).map(engineSnapshot);
    for (const snapshot of snapshots) expect(snapshot).toEqual(snapshots[0]);

    // Source order decides: the reply came first, so it is the first response
    // and the solve is the last event the clock saw.
    expect(snapshots[0]!.firstResponseEvent).toBe("reply");
    expect(snapshots[0]!.firstResponse.inputs.lastEvent?.type).toBe("case_closed");
  });

  it("a same-instant close and reopen resolve by source order, not by input order", () => {
    const closeThenReopen = [
      event("created", "08:00", "case_created", { toState: "open", sourceSequence: 0 }),
      event("close", "09:00", "case_closed", { fromState: "open", toState: "resolved", sourceSequence: 1 }),
      event("reopen", "09:00", "state_changed", { fromState: "resolved", toState: "open", sourceSequence: 2 }),
    ];
    for (const order of permutations(closeThenReopen)) {
      const result = engineSnapshot(order);
      expect(result.caseCloseEvent).toBeNull();
      expect(result.resolution.clock.state).toBe("running");
      expect(result.resolution.elapsedSeconds).toBe(4 * 60 * 60);
    }

    const reopenThenClose = [
      closeThenReopen[0]!,
      { ...closeThenReopen[2]!, sourceSequence: 1 },
      { ...closeThenReopen[1]!, sourceSequence: 2 },
    ];
    for (const order of permutations(reopenThenClose)) {
      const result = engineSnapshot(order);
      expect(result.caseCloseEvent).toBe("close");
      expect(result.resolution.status).toBe("met");
      expect(result.resolution.elapsedSeconds).toBe(60 * 60);
    }
  });

  it("same-instant pause transitions within one system resolve by source order", () => {
    const events = [
      event("created", "08:00", "case_created", { toState: "open", sourceSequence: 0 }),
      event("pending", "09:00", "state_changed", { fromState: "open", toState: "pending_customer", sourceSequence: 1 }),
      event("open", "09:00", "state_changed", { fromState: "pending_customer", toState: "open", sourceSequence: 2 }),
    ];
    for (const order of permutations(events)) {
      const fold = foldClockIntervals(order, policy.pauseOnStates, { start: at("08:00"), end: AS_OF });
      expect(fold.currentPause).toBeNull();
    }
  });

  it("shuffling a realistic multi-system stream never changes any engine output", () => {
    const events: NormalizedEvent[] = [
      event("created", "08:00", "case_created", { toState: "new", sourceSequence: 0 }),
      event("open", "08:00", "state_changed", { fromState: "new", toState: "open", sourceSequence: 1 }),
      event("reply-1", "08:40", "agent_replied", { sourceSequence: 2 }),
      event("pending", "08:40", "state_changed", { fromState: "open", toState: "pending_customer", sourceSequence: 3 }),
      event("link", "08:40", "issue_linked", { system: "jira", actor: "system", sourceSequence: 0 }),
      event("jira-progress", "08:40", "state_changed", { system: "jira", toState: "in_progress", sourceSequence: 1 }),
      event("reopen", "09:30", "state_changed", { fromState: "pending_customer", toState: "open", actor: "customer", sourceSequence: 4 }),
      event("reply-2", "10:00", "agent_replied", { sourceSequence: 5 }),
      event("solve", "10:00", "case_closed", { fromState: "open", toState: "resolved", sourceSequence: 6 }),
      event("jira-done", "10:00", "state_changed", { system: "jira", toState: "done", sourceSequence: 2 }),
      event("legacy", "10:00", "state_changed", { system: "linear", toState: "in_progress" }),
    ];
    const baseline = engineSnapshot(events);
    const random = seededRandom(20260917);
    for (let run = 0; run < 50; run++) {
      expect(engineSnapshot(shuffle(events, random))).toEqual(baseline);
    }
  });
});
