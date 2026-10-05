import { describe, expect, it } from "vitest";
import {
  computeElapsedWorkingMinutes,
  deriveLegSpans,
  deriveNextReplyCycles,
  findFirstResponseEvent,
  legAtTime,
  type BusinessCalendarVersion,
  type NormalizedEvent,
} from "@sla/core";
import {
  deriveCaseClosedAt,
  deriveIntercomSubject,
  deriveNormalizedEventsForConversation,
  extractIntercomMessageBody,
  normalizeIntercomEffectiveState,
  normalizeIntercomPriority,
  normalizeIntercomState,
  resolveIntercomActor,
  sortPartsChronologically,
  UnknownIntercomStateError,
  type ConversationPartRecord,
  type DerivedNormalizedEvent,
  type TicketStatePartRecord,
} from "../src/normalize";
import type { IntercomConversationPart, IntercomConversationWithParts } from "../src/types";

const conversation: IntercomConversationWithParts = {
  id: "42",
  created_at: 1_700_000_000, // 2023-11-14T22:13:20Z
  updated_at: 1_700_100_000,
  state: "closed",
  source: { type: "conversation", author: { type: "user", id: "u1" } },
};

function part(overrides: Partial<IntercomConversationPart> & { id: string }): ConversationPartRecord {
  return {
    rawEventId: `raw_${overrides.id}`,
    part: {
      part_type: "comment",
      created_at: conversation.created_at + 100,
      author: { type: "admin", id: "admin-1" },
      ...overrides,
    },
  };
}

describe("normalizeIntercomState", () => {
  it("maps every known Intercom state", () => {
    expect(normalizeIntercomState("open")).toBe("open");
    expect(normalizeIntercomState("snoozed")).toBe("pending_internal");
    expect(normalizeIntercomState("closed")).toBe("resolved");
  });

  it("throws a named error on an unrecognized state", () => {
    expect(() => normalizeIntercomState("bogus")).toThrow(UnknownIntercomStateError);
  });
});

describe("resolveIntercomActor", () => {
  it("attributes a bot/team/operator author to the system", () => {
    expect(resolveIntercomActor({ type: "bot" })).toBe("system");
    expect(resolveIntercomActor({ type: "team" })).toBe("system");
    expect(resolveIntercomActor({ type: "operator" })).toBe("system");
  });

  it("attributes a user/lead/contact author to the customer", () => {
    expect(resolveIntercomActor({ type: "user" })).toBe("customer");
    expect(resolveIntercomActor({ type: "lead" })).toBe("customer");
    expect(resolveIntercomActor({ type: "contact" })).toBe("customer");
  });

  it("attributes an admin author to the agent", () => {
    expect(resolveIntercomActor({ type: "admin" })).toBe("agent");
  });

  it("attributes a missing author to the system", () => {
    expect(resolveIntercomActor(null)).toBe("system");
    expect(resolveIntercomActor(undefined)).toBe("system");
  });
});

describe("sortPartsChronologically", () => {
  it("orders by created_at, then by part id as a tiebreaker", () => {
    const a = part({ id: "c", created_at: 10 });
    const b = part({ id: "a", created_at: 5 });
    const c = part({ id: "b", created_at: 5 });
    expect(sortPartsChronologically([a, b, c]).map((r) => r.rawEventId)).toEqual(["raw_a", "raw_b", "raw_c"]);
  });
});

describe("deriveNormalizedEventsForConversation", () => {
  it("synthesizes case_created as open, from the conversation's own source author, when there are no parts", () => {
    const events = deriveNormalizedEventsForConversation(conversation, [], "raw_conversation_42");
    expect(events).toEqual([
      {
        type: "case_created",
        occurredAt: new Date(conversation.created_at * 1000).toISOString(),
        actor: "customer",
        fromState: null,
        toState: "open",
        sourceRawEventId: "raw_conversation_42",
        sourceSequence: 0,
      },
    ]);
  });

  it("replays a close part as case_closed, tracking state from open", () => {
    const parts = [part({ id: "1", part_type: "close", created_at: conversation.created_at + 100 })];
    const events = deriveNormalizedEventsForConversation(conversation, parts, "raw_conversation_42");

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "case_closed",
      fromState: "open",
      toState: "resolved",
      actor: "agent",
      sourceRawEventId: "raw_1",
    });
  });

  it("replays snoozed then close as two ordered transitions", () => {
    const parts = [
      part({ id: "1", part_type: "snoozed", created_at: conversation.created_at + 100 }),
      part({ id: "2", part_type: "close", created_at: conversation.created_at + 200 }),
    ];
    const events = deriveNormalizedEventsForConversation(conversation, parts, "raw_conversation_42");

    expect(events.map((e) => e.type)).toEqual(["case_created", "state_changed", "case_closed"]);
    expect(events[1]).toMatchObject({ fromState: "open", toState: "pending_internal" });
    expect(events[2]).toMatchObject({ fromState: "pending_internal", toState: "resolved" });
  });

  it("emits a plain state_changed when a closed conversation is reopened", () => {
    const parts = [
      part({ id: "1", part_type: "close", created_at: conversation.created_at + 100 }),
      part({ id: "2", part_type: "open", created_at: conversation.created_at + 200 }),
    ];
    const events = deriveNormalizedEventsForConversation(conversation, parts, "raw_conversation_42");

    expect(events.map((e) => e.type)).toEqual(["case_created", "case_closed", "state_changed"]);
    expect(events[2]).toMatchObject({ fromState: "resolved", toState: "open" });
  });

  it("skips a transition part whose target state matches the currently-tracked state", () => {
    const parts = [
      part({ id: "1", part_type: "close", created_at: conversation.created_at + 100 }),
      // A redundant re-close (e.g. two close webhooks for the same event) — must not double-emit.
      part({ id: "2", part_type: "close", created_at: conversation.created_at + 200 }),
    ];
    const events = deriveNormalizedEventsForConversation(conversation, parts, "raw_conversation_42");
    expect(events.map((e) => e.type)).toEqual(["case_created", "case_closed"]);
  });

  it("ignores non-transition part types", () => {
    const parts = [
      part({ id: "1", part_type: "comment", created_at: conversation.created_at + 100 }),
      part({ id: "2", part_type: "note", created_at: conversation.created_at + 200 }),
      part({ id: "3", part_type: "assignment", created_at: conversation.created_at + 300 }),
    ];
    const events = deriveNormalizedEventsForConversation(conversation, parts, "raw_conversation_42");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("case_created");
  });

  it("resolves each transition's actor independently from its own part", () => {
    const parts = [
      part({ id: "1", part_type: "snoozed", created_at: conversation.created_at + 100, author: { type: "admin", id: "a1" } }),
      part({ id: "2", part_type: "close", created_at: conversation.created_at + 200, author: { type: "bot", id: "b1" } }),
    ];
    const events = deriveNormalizedEventsForConversation(conversation, parts, "raw_conversation_42");
    expect(events[1]?.actor).toBe("agent");
    expect(events[2]?.actor).toBe("system");
  });
});

describe("deriveCaseClosedAt", () => {
  const closedEvent: DerivedNormalizedEvent = {
    type: "case_closed",
    occurredAt: "2026-01-02T09:00:00Z",
    actor: "agent",
    fromState: "open",
    toState: "resolved",
    sourceRawEventId: "raw_1",
  };
  const createdEvent: DerivedNormalizedEvent = {
    type: "case_created",
    occurredAt: "2026-01-01T09:00:00Z",
    actor: "customer",
    fromState: null,
    toState: "open",
    sourceRawEventId: "raw_conversation_42",
  };

  it("is set from the close transition when the conversation is currently closed", () => {
    const closedAt = deriveCaseClosedAt({ ...conversation, state: "closed" }, [createdEvent, closedEvent]);
    expect(closedAt?.toISOString()).toBe("2026-01-02T09:00:00.000Z");
  });

  it("is null for an open or snoozed conversation", () => {
    expect(deriveCaseClosedAt({ ...conversation, state: "open" }, [createdEvent])).toBeNull();
    expect(deriveCaseClosedAt({ ...conversation, state: "snoozed" }, [createdEvent])).toBeNull();
  });

  it("is null again once a closed conversation is reopened, even though a case_closed event exists in its history", () => {
    const reopened: DerivedNormalizedEvent = {
      type: "state_changed",
      occurredAt: "2026-01-02T15:00:00Z",
      actor: "customer",
      fromState: "resolved",
      toState: "open",
      sourceRawEventId: "raw_2",
    };
    const closedAt = deriveCaseClosedAt({ ...conversation, state: "open" }, [createdEvent, closedEvent, reopened]);
    expect(closedAt).toBeNull();
  });

  it("falls back to the conversation's updated_at when no case_closed event was derived", () => {
    const updatedAtSeconds = 1_700_200_000;
    const closedAt = deriveCaseClosedAt({ ...conversation, state: "closed", updated_at: updatedAtSeconds }, [
      { ...createdEvent, toState: "resolved" },
    ]);
    expect(closedAt?.toISOString()).toBe(new Date(updatedAtSeconds * 1000).toISOString());
  });

  it("uses the most recent case_closed event when the conversation was closed more than once", () => {
    const secondClose: DerivedNormalizedEvent = {
      type: "case_closed",
      occurredAt: "2026-01-04T10:00:00Z",
      actor: "agent",
      fromState: "open",
      toState: "resolved",
      sourceRawEventId: "raw_3",
    };
    const closedAt = deriveCaseClosedAt({ ...conversation, state: "closed" }, [createdEvent, closedEvent, secondClose]);
    expect(closedAt?.toISOString()).toBe("2026-01-04T10:00:00.000Z");
  });
});

describe("normalizeIntercomPriority", () => {
  it("maps Intercom's binary priority onto the policy-matchable vocabulary", () => {
    expect(normalizeIntercomPriority("priority")).toBe("high");
    expect(normalizeIntercomPriority("not_priority")).toBe("normal");
  });

  it("passes through unknown values and nulls", () => {
    expect(normalizeIntercomPriority("urgent")).toBe("urgent");
    expect(normalizeIntercomPriority(null)).toBeNull();
    expect(normalizeIntercomPriority(undefined)).toBeNull();
  });
});

describe("deriveIntercomSubject", () => {
  it("prefers the conversation's own title", () => {
    expect(deriveIntercomSubject({ ...conversation, title: "Login broken" })).toBe("Login broken");
  });

  it("falls back to the ticket title attribute when the title is blank", () => {
    expect(
      deriveIntercomSubject({
        ...conversation,
        title: "",
        ticket: { custom_attributes: { _default_title_: { value: "Cannot export CSV" } } },
      }),
    ).toBe("Cannot export CSV");
  });

  it("falls back to the source subject, else null", () => {
    expect(
      deriveIntercomSubject({ ...conversation, source: { type: "email", subject: "Invoice question" } }),
    ).toBe("Invoice question");
    expect(deriveIntercomSubject(conversation)).toBeNull();
  });

  it("falls back to the opening message's plain text for a chat with no title", () => {
    expect(
      deriveIntercomSubject({
        ...conversation,
        source: { type: "conversation", body: "<p>How do I reset my&nbsp;password?</p>" },
      }),
    ).toBe("How do I reset my password?");
  });

  it("truncates a long opening message", () => {
    const subject = deriveIntercomSubject({
      ...conversation,
      source: { type: "conversation", body: `<p>${"a".repeat(300)}</p>` },
    });
    expect(subject).toHaveLength(120);
    expect(subject?.endsWith("…")).toBe(true);
  });

  it("uses the first customer comment with text when the opening message is empty", () => {
    const parts = [
      part({ id: "p1", part_type: "comment", author: { type: "admin", id: "a" }, body: "<p>Agent reply</p>" }),
      part({ id: "p2", part_type: "comment", author: { type: "user", id: "u" }, body: '<img src="x.png">' }),
      part({ id: "p2b", part_type: "comment", author: { type: "user", id: "u" }, body: "<a href=\"https://x.io/a.png\">https://x.io/a.png</a>" }),
      part({ id: "p3", part_type: "comment", author: { type: "user", id: "u" }, body: "<p>https://x.io/b.gif</p><p>My SMS is broken</p>" }),
    ];
    expect(deriveIntercomSubject({ ...conversation, source: { type: "conversation", body: null } }, parts)).toBe(
      "My SMS is broken",
    );
  });
});

describe("deriveNormalizedEventsForConversation agent replies", () => {
  const openConversation: IntercomConversationWithParts = { ...conversation, state: "open" };
  const replies = (events: DerivedNormalizedEvent[]) => events.filter((e) => e.type === "agent_replied");

  it("emits agent_replied for an admin comment with a body", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [part({ id: "p1", body: "<p>On it</p>" })],
      "raw_conversation",
    );
    expect(replies(events)).toEqual([
      {
        type: "agent_replied",
        occurredAt: new Date((conversation.created_at + 100) * 1000).toISOString(),
        actor: "agent",
        fromState: null,
        toState: null,
        sourceRawEventId: "raw_p1",
        sourceSequence: 2,
      },
    ]);
  });

  it("counts a reply sent together with a close, after the close transition", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [part({ id: "p1", part_type: "close", body: "<p>Fixed, closing</p>" })],
      "raw_conversation",
    );
    expect(events.map((e) => e.type)).toEqual(["case_created", "case_closed", "agent_replied"]);
  });

  it("ignores notes, bot and customer messages, and body-less admin parts", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [
        part({ id: "p1", part_type: "note", body: "<p>internal</p>" }),
        part({ id: "p2", body: "<p>Fin here</p>", author: { type: "bot", id: "fin" } }),
        part({ id: "p3", body: "<p>any update?</p>", author: { type: "user", id: "u1" } }),
        part({ id: "p4", part_type: "assignment", body: null }),
        part({ id: "p5", body: "   " }),
      ],
      "raw_conversation",
    );
    expect(replies(events)).toEqual([]);
  });
});

describe("deriveNormalizedEventsForConversation source ordering", () => {
  const openConversation: IntercomConversationWithParts = { ...conversation, state: "open" };
  const sameSecond = conversation.created_at + 100;

  it("assigns increasing sequences in part order, a part's transition before its reply", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [
        part({ id: "p2", created_at: sameSecond, part_type: "open", body: "<p>back on it</p>" }),
        part({ id: "p1", created_at: sameSecond, part_type: "close", body: "<p>closing</p>" }),
      ],
      "raw_conversation",
    );

    expect(events.map((e) => `${e.sourceRawEventId}:${e.type}`)).toEqual([
      "raw_conversation:case_created",
      "raw_p1:case_closed",
      "raw_p1:agent_replied",
      "raw_p2:state_changed",
      "raw_p2:agent_replied",
    ]);
    const sequences = events.map((e) => e.sourceSequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it("is idempotent across repeated normalization and part load order", () => {
    const parts = [
      part({ id: "p1", created_at: sameSecond, part_type: "close", body: "<p>closing</p>" }),
      part({ id: "p2", created_at: sameSecond, part_type: "open" }),
      part({ id: "p3", created_at: sameSecond + 60, body: "<p>update</p>" }),
    ];
    const first = deriveNormalizedEventsForConversation(openConversation, parts, "raw_conversation");
    expect(deriveNormalizedEventsForConversation(openConversation, parts, "raw_conversation")).toEqual(first);
    expect(deriveNormalizedEventsForConversation(openConversation, [...parts].reverse(), "raw_conversation")).toEqual(first);
  });
});

describe("deriveNormalizedEventsForConversation customer replies", () => {
  const openConversation: IntercomConversationWithParts = { ...conversation, state: "open" };
  const customer = { type: "user", id: "u1" };
  const replyEvents = (events: DerivedNormalizedEvent[]) =>
    events
      .filter((e) => e.type === "customer_replied" || e.type === "agent_replied")
      .map((e) => [e.type, e.actor, e.sourceRawEventId]);

  it("keeps both a customer comment and the agent's reply", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [
        part({ id: "p1", created_at: conversation.created_at + 100, author: customer, body: "<p>any update?</p>" }),
        part({ id: "p2", created_at: conversation.created_at + 200, body: "<p>On it</p>" }),
      ],
      "raw_conversation",
    );
    expect(events.find((e) => e.type === "customer_replied")).toEqual({
      type: "customer_replied",
      occurredAt: new Date((conversation.created_at + 100) * 1000).toISOString(),
      actor: "customer",
      fromState: null,
      toState: null,
      sourceRawEventId: "raw_p1",
      sourceSequence: 2,
    });
    expect(replyEvents(events)).toEqual([
      ["customer_replied", "customer", "raw_p1"],
      ["agent_replied", "agent", "raw_p2"],
    ]);
  });

  it("does not turn an internal note between them into a customer reply", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [
        part({ id: "p1", created_at: conversation.created_at + 100, author: customer, body: "<p>any update?</p>" }),
        part({ id: "p2", created_at: conversation.created_at + 150, part_type: "note", body: "<p>internal</p>" }),
        part({ id: "p3", created_at: conversation.created_at + 200, body: "<p>On it</p>" }),
      ],
      "raw_conversation",
    );
    expect(events.map((e) => e.type)).toEqual(["case_created", "customer_replied", "agent_replied"]);
  });

  it("recognizes lead and contact authors as customers", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [
        part({ id: "p1", created_at: conversation.created_at + 100, author: { type: "lead", id: "l1" }, body: "<p>hi</p>" }),
        part({ id: "p2", created_at: conversation.created_at + 200, author: { type: "contact", id: "c1" }, body: "<p>hi</p>" }),
      ],
      "raw_conversation",
    );
    expect(replyEvents(events)).toEqual([
      ["customer_replied", "customer", "raw_p1"],
      ["customer_replied", "customer", "raw_p2"],
    ]);
  });

  it("ignores bot messages, body-less customer parts, and parts with no author", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [
        part({ id: "p1", body: "<p>Fin here</p>", author: { type: "bot", id: "fin" } }),
        part({ id: "p2", body: "  ", author: customer }),
        part({ id: "p3", body: null, author: customer }),
        part({ id: "p4", body: "<p>orphan</p>", author: undefined }),
      ],
      "raw_conversation",
    );
    expect(replyEvents(events)).toEqual([]);
  });

  it("emits a customer reply that reopens a closed conversation after its transition", () => {
    const events = deriveNormalizedEventsForConversation(
      openConversation,
      [
        part({ id: "p1", created_at: conversation.created_at + 100, part_type: "close", body: null }),
        part({ id: "p2", created_at: conversation.created_at + 200, part_type: "open", author: customer, body: "<p>still broken</p>" }),
      ],
      "raw_conversation",
    );
    expect(events.map((e) => `${e.sourceRawEventId}:${e.type}`)).toEqual([
      "raw_conversation:case_created",
      "raw_p1:case_closed",
      "raw_p2:state_changed",
      "raw_p2:customer_replied",
    ]);
  });
});

describe("Next Reply cycles from derived conversation events", () => {
  const openConversation: IntercomConversationWithParts = { ...conversation, state: "open" };
  const customer = { type: "user", id: "u1" };
  const AS_OF = new Date((conversation.created_at + 10_000) * 1000).toISOString();
  const iso = (offset: number) => new Date((conversation.created_at + offset) * 1000).toISOString();

  const toCoreEvents = (derived: DerivedNormalizedEvent[]): NormalizedEvent[] =>
    derived.map((event, i) => ({ ...event, id: `evt-${i}`, caseId: "case-42", system: "intercom", sourceRole: "ticket_source" as const }));

  const cycles = (events: NormalizedEvent[]) =>
    deriveNextReplyCycles(events, { asOf: AS_OF, firstResponseCompletion: findFirstResponseEvent(events, AS_OF) }).map(
      (c) => [c.startedAt, c.completedAt, c.completion?.sourceRawEventId ?? null, c.customerReplies.map((r) => r.sourceRawEventId)],
    );

  it("derives cycles past notes, bots, repeated admin replies, reply-and-close, and a customer reopen", () => {
    const events = toCoreEvents(
      deriveNormalizedEventsForConversation(
        openConversation,
        [
          // Covered by first response.
          part({ id: "p01", created_at: conversation.created_at + 100, author: customer, body: "<p>help</p>" }),
          part({ id: "p02", created_at: conversation.created_at + 150, part_type: "note", body: "<p>internal</p>" }),
          part({ id: "p03", created_at: conversation.created_at + 200, body: "<p>looking</p>" }),
          // Cycle 1: two customer replies around a bot message, answered by a reply-and-close.
          part({ id: "p04", created_at: conversation.created_at + 300, author: customer, body: "<p>any news?</p>" }),
          part({ id: "p05", created_at: conversation.created_at + 310, author: { type: "bot", id: "fin" }, body: "<p>Fin here</p>" }),
          part({ id: "p06", created_at: conversation.created_at + 320, author: customer, body: "<p>hello?</p>" }),
          part({ id: "p07", created_at: conversation.created_at + 400, part_type: "close", body: "<p>fixed</p>" }),
          part({ id: "p08", created_at: conversation.created_at + 410, body: "<p>also...</p>" }),
          // Cycle 2: the customer reopens by replying; nobody has answered yet.
          part({ id: "p09", created_at: conversation.created_at + 500, part_type: "open", author: customer, body: "<p>still broken</p>" }),
        ],
        "raw_conversation",
      ),
    );

    expect(cycles(events)).toEqual([
      [iso(300), iso(400), "raw_p07", ["raw_p04", "raw_p06"]],
      [iso(500), null, null, ["raw_p09"]],
    ]);
  });
});

describe("extractIntercomMessageBody", () => {
  it("extracts a visible reply part's HTML body and author name", () => {
    const message = extractIntercomMessageBody(
      part({ id: "p1", part_type: "comment", body: "<p>hello there</p>", author: { type: "user", id: "u1", name: "Jane Customer" } }).part,
    );
    expect(message).toEqual({ authorName: "Jane Customer", bodyHtml: "<p>hello there</p>" });
  });

  it("returns null author name when the part carries none", () => {
    const message = extractIntercomMessageBody(
      part({ id: "p1", part_type: "comment", body: "<p>hi</p>", author: { type: "admin", id: "a1" } }).part,
    );
    expect(message).toEqual({ authorName: null, bodyHtml: "<p>hi</p>" });
  });

  it("returns null for a private note, even though it carries a body", () => {
    const message = extractIntercomMessageBody(
      part({ id: "p1", part_type: "note", body: "<p>internal only</p>", author: { type: "admin", id: "a1" } }).part,
    );
    expect(message).toBeNull();
  });

  it("returns null for a part with no body (e.g. a bare assignment)", () => {
    const message = extractIntercomMessageBody(
      part({ id: "p1", part_type: "assignment", body: null, author: { type: "admin", id: "a1" } }).part,
    );
    expect(message).toBeNull();
  });
});

describe("normalizeIntercomEffectiveState", () => {
  it("maps a ticket waiting on the customer to pending_customer while the conversation is open", () => {
    expect(normalizeIntercomEffectiveState("open", "waiting_on_customer")).toBe("pending_customer");
  });

  it("keeps submitted, in-progress, unknown and absent ticket states as open", () => {
    expect(normalizeIntercomEffectiveState("open", "submitted")).toBe("open");
    expect(normalizeIntercomEffectiveState("open", "in_progress")).toBe("open");
    expect(normalizeIntercomEffectiveState("open", "some_future_state")).toBe("open");
    expect(normalizeIntercomEffectiveState("open", null)).toBe("open");
    expect(normalizeIntercomEffectiveState("open", undefined)).toBe("open");
  });

  it("lets a customer-caused wait outrank a snooze, so the pause is not lost", () => {
    expect(normalizeIntercomEffectiveState("snoozed", "waiting_on_customer")).toBe("pending_customer");
    expect(normalizeIntercomEffectiveState("snoozed", "in_progress")).toBe("pending_internal");
    expect(normalizeIntercomEffectiveState("snoozed", null)).toBe("pending_internal");
  });

  it("is resolved whenever the conversation is closed, whatever the ticket state says", () => {
    expect(normalizeIntercomEffectiveState("closed", "waiting_on_customer")).toBe("resolved");
    expect(normalizeIntercomEffectiveState("closed", "resolved")).toBe("resolved");
    expect(normalizeIntercomEffectiveState("closed", null)).toBe("resolved");
  });
});

/**
 * Intercom ticket "Waiting on customer" (verified against GET /conversations/{id}
 * and GET /tickets/{id}, Intercom-Version 2.11): the conversation stays `open`
 * and its `ticket_state_updated_by_admin` part names no state; the state it
 * moved to is on the matching `ticket_parts` entry.
 */
describe("deriveNormalizedEventsForConversation ticket state (Waiting on customer)", () => {
  const openConversation: IntercomConversationWithParts = { ...conversation, state: "open" };
  const at = (offset: number) => conversation.created_at + offset;
  const iso = (offset: number) => new Date(at(offset) * 1000).toISOString();

  const stateChangePart = (id: string, offset: number) =>
    part({ id, part_type: "ticket_state_updated_by_admin", created_at: at(offset), body: null });
  const ticketRecord = (id: string, offset: number, previous: string, state: string): TicketStatePartRecord => ({
    rawEventId: `raw_ticket_${id}`,
    part: { id, part_type: "ticket_state_updated_by_admin", created_at: at(offset), previous_ticket_state: previous, ticket_state: state },
  });
  const derive = (
    parts: ConversationPartRecord[],
    ticketParts: TicketStatePartRecord[] = [],
    conv: IntercomConversationWithParts = openConversation,
  ) => deriveNormalizedEventsForConversation(conv, parts, "raw_conversation_42", ticketParts);
  const transitions = (events: DerivedNormalizedEvent[]) =>
    events.filter((e) => e.fromState !== null).map((e) => [e.type, e.fromState, e.toState, e.occurredAt]);

  it("emits state_changed open -> pending_customer when the ticket moves to waiting_on_customer", () => {
    const events = derive(
      [stateChangePart("t1", 100), stateChangePart("t2", 200)],
      [ticketRecord("t1", 100, "submitted", "in_progress"), ticketRecord("t2", 200, "in_progress", "waiting_on_customer")],
    );

    // submitted -> in_progress is still `open`: no transition for it.
    expect(transitions(events)).toEqual([["state_changed", "open", "pending_customer", iso(200)]]);
    expect(events.at(-1)).toMatchObject({ actor: "agent", sourceRawEventId: "raw_ticket_t2" });
  });

  it("emits state_changed pending_customer -> open when the ticket leaves waiting_on_customer", () => {
    const events = derive(
      [stateChangePart("t1", 100), stateChangePart("t2", 200)],
      [ticketRecord("t1", 100, "in_progress", "waiting_on_customer"), ticketRecord("t2", 200, "waiting_on_customer", "in_progress")],
    );

    expect(transitions(events)).toEqual([
      ["state_changed", "open", "pending_customer", iso(100)],
      ["state_changed", "pending_customer", "open", iso(200)],
    ]);
  });

  it("does not emit a transition for a ticket change between two non-waiting states", () => {
    const events = derive([stateChangePart("t1", 100)], [ticketRecord("t1", 100, "submitted", "in_progress")]);
    expect(events.map((e) => e.type)).toEqual(["case_created"]);
  });

  it("closes from pending_customer: case_closed carries the effective state it left", () => {
    const events = derive(
      [stateChangePart("t1", 100), part({ id: "c1", part_type: "close", created_at: at(200), body: null })],
      [ticketRecord("t1", 100, "in_progress", "waiting_on_customer")],
    );

    expect(transitions(events)).toEqual([
      ["state_changed", "open", "pending_customer", iso(100)],
      ["case_closed", "pending_customer", "resolved", iso(200)],
    ]);
  });

  it("returns to pending_customer, not open, when a conversation is reopened while the ticket is still waiting", () => {
    const events = derive(
      [
        stateChangePart("t1", 100),
        part({ id: "c1", part_type: "close", created_at: at(200), body: null }),
        part({ id: "c2", part_type: "open", created_at: at(300), body: null }),
      ],
      [ticketRecord("t1", 100, "in_progress", "waiting_on_customer")],
    );

    expect(transitions(events).map(([, from, to]) => `${from}>${to}`)).toEqual([
      "open>pending_customer",
      "pending_customer>resolved",
      "resolved>pending_customer",
    ]);
  });

  it("keeps a waiting ticket paused through a snooze and its end", () => {
    const events = derive(
      [
        stateChangePart("t1", 100),
        part({ id: "s1", part_type: "snoozed", created_at: at(200), body: null }),
        part({ id: "o1", part_type: "open", created_at: at(300), body: null }),
      ],
      [ticketRecord("t1", 100, "in_progress", "waiting_on_customer")],
    );
    expect(transitions(events)).toEqual([["state_changed", "open", "pending_customer", iso(100)]]);
  });

  it("is unchanged for a plain conversation with no ticket state parts", () => {
    const events = derive([part({ id: "1", part_type: "snoozed", created_at: at(100), body: null })]);
    expect(transitions(events)).toEqual([["state_changed", "open", "pending_internal", iso(100)]]);
  });

  describe("without ticket-API data (older raw events, or the ticket fetch failed)", () => {
    it("resolves the latest state-change part to the snapshot's current ticket.state", () => {
      const waiting = { ...openConversation, ticket: { id: "42", state: "waiting_on_customer" } };
      const events = derive([stateChangePart("t1", 100), stateChangePart("t2", 200)], [], waiting);

      // t1's target is unknown and skipped; t2 is the latest, so it is the snapshot's state.
      expect(transitions(events)).toEqual([["state_changed", "open", "pending_customer", iso(200)]]);
      expect(events.at(-1)).toMatchObject({ sourceRawEventId: "raw_t2" });
    });

    it("does not guess when the snapshot has no ticket state, or the ticket is no longer waiting", () => {
      expect(derive([stateChangePart("t1", 100)]).map((e) => e.type)).toEqual(["case_created"]);
      const inProgress = { ...openConversation, ticket: { id: "42", state: "in_progress" } };
      expect(derive([stateChangePart("t1", 100)], [], inProgress).map((e) => e.type)).toEqual(["case_created"]);
    });

    it("prefers the exact ticket part over the snapshot for the same part", () => {
      const waiting = { ...openConversation, ticket: { id: "42", state: "waiting_on_customer" } };
      const events = derive(
        [stateChangePart("t1", 100)],
        [ticketRecord("t1", 100, "waiting_on_customer", "in_progress")],
        waiting,
      );
      expect(events.map((e) => e.type)).toEqual(["case_created"]);
    });
  });

  describe("SLA pause and ownership, fed from the derived events", () => {
    const alwaysOpen: BusinessCalendarVersion = {
      id: "cal",
      version: 1,
      timezone: "UTC",
      weekly: [],
      holidays: [],
      alwaysOpen: true,
    };
    const toCoreEvents = (derived: DerivedNormalizedEvent[]): NormalizedEvent[] =>
      derived.map((event, i) => ({ ...event, id: `evt-${i}`, caseId: "case-42", system: "intercom", sourceRole: "ticket_source" as const }));
    // Support 0-600 s, waiting on the customer 600-1800 s, back with support from 1800 s.
    const events = toCoreEvents(
      derive(
        [stateChangePart("t1", 600), stateChangePart("t2", 1800)],
        [ticketRecord("t1", 600, "in_progress", "waiting_on_customer"), ticketRecord("t2", 1800, "waiting_on_customer", "in_progress")],
      ),
    );
    const window = (endOffset: number) => ({ start: iso(0), end: iso(endOffset) });
    const pauseStates = ["pending_customer" as const]; // what native policies pause on

    it("pauses the clock on entering the waiting state and counts nothing while it lasts", () => {
      const result = computeElapsedWorkingMinutes(events, pauseStates, alwaysOpen, window(1200));
      expect(result.elapsedWorkingMinutes).toBe(10); // only 0-600 s ran
      expect(result.pausedIntervals).toEqual([{ start: iso(600), end: iso(1200), cause: "pending_customer" }]);
    });

    it("resumes the clock when the ticket leaves the waiting state", () => {
      const result = computeElapsedWorkingMinutes(events, pauseStates, alwaysOpen, window(2400));
      expect(result.elapsedWorkingMinutes).toBe(20); // 0-600 s and 1800-2400 s
      expect(result.pausedIntervals).toEqual([{ start: iso(600), end: iso(1800), cause: "pending_customer" }]);
    });

    it("counts the whole window for a commitment that pauses on nothing (first response, next reply)", () => {
      const result = computeElapsedWorkingMinutes(events, [], alwaysOpen, window(2400));
      expect(result.elapsedWorkingMinutes).toBe(40);
    });

    it("attributes the waiting stretch to the customer, then back to support", () => {
      const { spans } = deriveLegSpans(events, { caseOpenedAt: iso(0) });
      expect(spans.map((s) => [s.leg, s.startedAt, s.endedAt])).toEqual([
        ["support", iso(0), iso(600)],
        ["waiting_customer", iso(600), iso(1800)],
        ["support", iso(1800), null],
      ]);
      expect(legAtTime(spans, iso(1000))).toBe("waiting_customer");
      expect(legAtTime(spans, iso(2000))).toBe("support");
    });
  });
});
