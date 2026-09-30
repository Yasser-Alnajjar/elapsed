import { withSourceRole } from "./source-role";
import { describe, expect, it } from "vitest";
import { findFirstResponseEvent } from "../src/evaluate";
import { deriveNextReplyCycles, nextReplyCycleKey } from "../src/reply-cycles";
import type { NormalizedEvent, NormalizedEventType, NormalizedState } from "../src/types";

/**
 * Next Reply cycles: the oldest unanswered customer reply starts a cycle, the
 * next public agent reply completes it. Only reply events on the ticket
 * source count, in `compareNormalizedEvents` order.
 */

const at = (time: string) => `2026-09-17T${time}:00.000Z`;
const AS_OF = at("23:00");

let seq = 0;
function event(
  time: string,
  type: NormalizedEventType,
  overrides: Partial<NormalizedEvent> & { toState?: NormalizedState | null } = {},
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
const customer = (time: string, overrides: Partial<NormalizedEvent> = {}) => event(time, "customer_replied", overrides);
const agent = (time: string, overrides: Partial<NormalizedEvent> = {}) => event(time, "agent_replied", overrides);

const derive = (events: NormalizedEvent[], asOf = AS_OF) => deriveNextReplyCycles(events, { asOf });

/** [startedAt, completedAt, customer reply count] per cycle. */
const summarize = (events: NormalizedEvent[], asOf = AS_OF, firstResponseCompletion?: NormalizedEvent | null) =>
  deriveNextReplyCycles(events, { asOf, firstResponseCompletion }).map((c) => [
    c.startedAt,
    c.completedAt,
    c.customerReplies.length,
  ]);

describe("deriveNextReplyCycles", () => {
  it("returns no cycles when the customer never replied", () => {
    expect(derive([created(), agent("09:00"), agent("10:00")])).toEqual([]);
  });

  it("customer → agent: one cycle carrying its anchor, replies, and completion", () => {
    const reply = customer("09:00");
    const answer = agent("10:00");
    expect(derive([created(), reply, answer])).toEqual([
      {
        key: `next_reply:zendesk:${reply.sourceRawEventId}:customer_replied:${at("09:00")}`,
        index: 0,
        startedAt: at("09:00"),
        anchor: {
          sourceRawEventId: reply.sourceRawEventId,
          system: "zendesk",
          type: "customer_replied",
          occurredAt: at("09:00"),
          toState: null,
        },
        customerReplies: [
          {
            sourceRawEventId: reply.sourceRawEventId,
            system: "zendesk",
            type: "customer_replied",
            occurredAt: at("09:00"),
            toState: null,
          },
        ],
        completedAt: at("10:00"),
        completion: {
          sourceRawEventId: answer.sourceRawEventId,
          system: "zendesk",
          type: "agent_replied",
          occurredAt: at("10:00"),
          toState: null,
        },
        completionType: "agent_replied",
      },
    ]);
  });

  it("customer → customer → agent: one cycle anchored at the oldest reply", () => {
    const first = customer("09:00");
    const second = customer("10:00");
    const [cycle] = derive([created(), first, second, agent("11:00")]);
    expect(cycle).toMatchObject({ startedAt: at("09:00"), completedAt: at("11:00") });
    expect(cycle!.anchor.sourceRawEventId).toBe(first.sourceRawEventId);
    expect(cycle!.customerReplies.map((r) => r.sourceRawEventId)).toEqual([
      first.sourceRawEventId,
      second.sourceRawEventId,
    ]);
  });

  it("customer → agent → customer → agent: two cycles", () => {
    const events = [created(), customer("09:00"), agent("10:00"), customer("12:00"), agent("13:00")];
    expect(summarize(events)).toEqual([
      [at("09:00"), at("10:00"), 1],
      [at("12:00"), at("13:00"), 1],
    ]);
    expect(derive(events).map((c) => c.index)).toEqual([0, 1]);
  });

  it("follows the plan's example: two replies then an answer, then another round", () => {
    const events = [customer("09:00"), customer("10:00"), agent("11:00"), customer("12:00"), agent("13:00")];
    expect(summarize(events)).toEqual([
      [at("09:00"), at("11:00"), 2],
      [at("12:00"), at("13:00"), 1],
    ]);
  });

  it("customer → agent → agent: consecutive agent replies create no cycle", () => {
    const events = [created(), customer("09:00"), agent("10:00"), agent("11:00"), agent("12:00")];
    expect(summarize(events)).toEqual([[at("09:00"), at("10:00"), 1]]);
  });

  it("leaves a trailing unanswered customer reply as an open cycle", () => {
    const events = [created(), customer("09:00"), agent("10:00"), customer("11:00"), customer("11:30")];
    expect(derive(events)[1]).toMatchObject({
      startedAt: at("11:00"),
      completedAt: null,
      completion: null,
      completionType: null,
    });
    expect(derive(events)[1]!.customerReplies).toHaveLength(2);
  });

  it("customer → pending → agent: a pending state neither pauses nor splits the cycle", () => {
    const events = [
      created(),
      customer("09:00"),
      event("09:30", "state_changed", { toState: "pending_customer" }),
      event("09:45", "state_changed", { toState: "open", actor: "system" }),
      agent("10:00"),
    ];
    expect(summarize(events)).toEqual([[at("09:00"), at("10:00"), 1]]);
    expect(derive(events)).toEqual(derive(events.filter((e) => e.type !== "state_changed")));
  });

  it("customer → case_closed: a close cancels the open cycle (D4), not answers it", () => {
    const events = [created(), customer("09:00"), event("10:00", "case_closed", { toState: "resolved" })];
    expect(derive(events)).toEqual([]);
  });

  it("customer → agent (completed) → customer → case_closed: only the still-open cycle is cancelled", () => {
    const events = [
      created(),
      customer("09:00"),
      agent("10:00"),
      customer("11:00"),
      event("12:00", "case_closed", { toState: "resolved" }),
    ];
    expect(summarize(events)).toEqual([[at("09:00"), at("10:00"), 1]]);
  });

  it("a customer reply after the close-cancelled cycle starts a fresh one (D4 reopen)", () => {
    const events = [
      created(),
      customer("09:00"),
      event("10:00", "case_closed", { toState: "resolved" }),
      event("11:00", "state_changed", { toState: "open" }),
      customer("12:00"),
      agent("13:00"),
    ];
    expect(summarize(events)).toEqual([[at("12:00"), at("13:00"), 1]]);
  });

  it("customer reply after resolution starts a new cycle whether or not the reopen comes first", () => {
    const events = [
      created(),
      customer("09:00"),
      agent("10:00"),
      event("11:00", "case_closed", { toState: "resolved" }),
      // Zendesk lists the comment before the reopen in the same audit.
      customer("12:00", { sourceRawEventId: "raw-audit-12", sourceSequence: 7 }),
      event("12:00", "state_changed", { toState: "open", sourceRawEventId: "raw-audit-12", sourceSequence: 8 }),
      agent("13:00"),
    ];
    expect(summarize(events)).toEqual([
      [at("09:00"), at("10:00"), 1],
      [at("12:00"), at("13:00"), 1],
    ]);
  });

  it("ignores replies from non-ticket systems", () => {
    const events = [
      created(),
      customer("09:00", { system: "jira" }),
      customer("10:00"),
      agent("10:30", { system: "jira" }),
      agent("11:00"),
    ];
    expect(summarize(events)).toEqual([[at("10:00"), at("11:00"), 1]]);
  });

  it("works for an Intercom case", () => {
    const events = [customer("09:00", { system: "intercom" }), agent("10:00", { system: "intercom" })];
    expect(summarize(events)).toEqual([[at("09:00"), at("10:00"), 1]]);
    expect(derive(events)[0]!.key).toContain("next_reply:intercom:");
  });

  describe("asOf", () => {
    const events = [created(), customer("09:00"), agent("10:00"), customer("11:00")];

    it("ignores events after asOf", () => {
      expect(summarize(events, at("09:30"))).toEqual([[at("09:00"), null, 1]]);
      expect(summarize(events, at("08:30"))).toEqual([]);
    });

    it("includes an event exactly at asOf", () => {
      expect(summarize(events, at("10:00"))).toEqual([[at("09:00"), at("10:00"), 1]]);
    });

    it("keeps an earlier completed cycle's key when a later cycle appears", () => {
      const before = derive(events, at("10:30"));
      const after = derive(events, AS_OF);
      expect(after[0]).toEqual(before[0]);
      expect(after).toHaveLength(2);
    });

    it("compares instants, not timestamp strings", () => {
      // "…10:00:00Z" sorts after "…10:00:00.000Z" as a string but is the same instant.
      const mixed = [
        customer("09:00", { occurredAt: "2026-09-17T09:00:00Z" }),
        agent("10:00", { occurredAt: "2026-09-17T10:00:00Z" }),
      ];
      expect(summarize(mixed, at("10:00"))).toEqual([[at("09:00"), at("10:00"), 1]]);
    });

    it("rejects an invalid asOf", () => {
      expect(() => deriveNextReplyCycles(events, { asOf: "not a date" })).toThrow(RangeError);
    });
  });

  describe("same-timestamp events", () => {
    it("completes the cycle when the customer reply sorts before the agent reply", () => {
      const events = [customer("09:00", { sourceSequence: 1 }), agent("09:00", { sourceSequence: 2 })];
      expect(summarize(events)).toEqual([[at("09:00"), at("09:00"), 1]]);
    });

    it("leaves the cycle open when the agent reply sorts first", () => {
      const events = [agent("09:00", { sourceSequence: 1 }), customer("09:00", { sourceSequence: 2 })];
      expect(summarize(events)).toEqual([[at("09:00"), null, 1]]);
    });

    it("uses the deterministic fallback when sequences tie", () => {
      const events = [
        agent("09:00", { sourceRawEventId: "raw-a" }),
        customer("09:00", { sourceRawEventId: "raw-b" }),
      ];
      expect(summarize(events)).toEqual([[at("09:00"), null, 1]]);
    });

    it("is independent of input order", () => {
      const events = [
        created(),
        customer("09:00", { sourceSequence: 3 }),
        agent("09:00", { sourceSequence: 4 }),
        customer("09:00", { sourceSequence: 5 }),
        customer("10:00", { sourceSequence: 6 }),
        agent("10:00", { sourceSequence: 7 }),
        agent("10:00", { sourceSequence: 8 }),
      ];
      const expected = derive(events);
      expect(summarize(events)).toEqual([
        [at("09:00"), at("09:00"), 1],
        [at("09:00"), at("10:00"), 2],
      ]);
      expect(derive([...events].reverse())).toEqual(expected);
      expect(derive([events[4]!, events[1]!, events[6]!, events[0]!, events[3]!, events[5]!, events[2]!])).toEqual(expected);
    });
  });

  describe("first response gating", () => {
    it("does not gate when firstResponseCompletion is omitted", () => {
      const events = [created(), customer("08:30"), agent("09:00")];
      expect(summarize(events, AS_OF, undefined)).toEqual([[at("08:30"), at("09:00"), 1]]);
    });

    it("counts no customer reply while first response is still open (null)", () => {
      const events = [created(), customer("08:30"), customer("09:00")];
      expect(summarize(events, AS_OF, null)).toEqual([]);
    });

    it("leaves customer replies before the first agent reply to first response", () => {
      const firstReply = agent("10:00");
      const events = [created(), customer("09:00"), customer("09:30"), firstReply, customer("11:00"), agent("12:00")];
      expect(summarize(events, AS_OF, firstReply)).toEqual([[at("11:00"), at("12:00"), 1]]);
    });

    it("gates on what findFirstResponseEvent returns, including a reply-less close", () => {
      const close = event("10:00", "case_closed", { toState: "resolved" });
      const events = [
        created(),
        customer("09:00"),
        close,
        customer("11:00"),
        event("11:00", "state_changed", { toState: "open" }),
        agent("12:00"),
      ];
      const completion = findFirstResponseEvent(events, AS_OF);
      expect(completion).toBe(close);
      expect(summarize(events, AS_OF, completion)).toEqual([[at("11:00"), at("12:00"), 1]]);
    });

    it("keeps a same-instant customer reply sorting before the first response in first response", () => {
      const firstReply = agent("10:00", { sourceSequence: 2 });
      const events = [created(), customer("10:00", { sourceSequence: 1 }), firstReply, agent("11:00")];
      expect(summarize(events, AS_OF, firstReply)).toEqual([]);
    });

    it("lets a same-instant customer reply sorting after the first response start the first cycle", () => {
      const firstReply = agent("10:00", { sourceSequence: 1 });
      const events = [created(), firstReply, customer("10:00", { sourceSequence: 2 }), agent("11:00")];
      expect(summarize(events, AS_OF, firstReply)).toEqual([[at("10:00"), at("11:00"), 1]]);
    });

    it("does not let the first-response reply itself complete a cycle", () => {
      const firstReply = agent("10:00");
      const events = [created(), customer("09:00"), firstReply];
      expect(summarize(events, AS_OF, firstReply)).toEqual([]);
    });
  });
});

describe("nextReplyCycleKey", () => {
  const ref = {
    sourceRawEventId: "raw-1",
    system: "zendesk" as const,
    type: "customer_replied" as const,
    occurredAt: "2026-09-17T09:00:00Z",
    toState: null,
  };

  it("is the same for the same instant written with or without milliseconds", () => {
    expect(nextReplyCycleKey(ref)).toBe(nextReplyCycleKey({ ...ref, occurredAt: at("09:00") }));
  });

  it("ignores regenerated event ids and shifted source sequences", () => {
    const a = customer("09:00", { id: "first-run", sourceRawEventId: "raw-audit", sourceSequence: 3 });
    const b = customer("09:00", { id: "second-run", sourceRawEventId: "raw-audit", sourceSequence: 9 });
    expect(derive([a])[0]!.key).toBe(derive([b])[0]!.key);
  });

  it("differs between source events", () => {
    expect(nextReplyCycleKey(ref)).not.toBe(nextReplyCycleKey({ ...ref, sourceRawEventId: "raw-2" }));
  });
});
