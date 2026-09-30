import { describe, expect, it } from "vitest";
import { deriveNextReplyCycles, findFirstResponseEvent, resolveFirstResponseStartedAt, type NormalizedEvent } from "@sla/core";
import {
  deriveCaseClosedAt,
  deriveNormalizedEventsForTicket,
  normalizeZendeskPriority,
  normalizeZendeskStatus,
  publicCommentBodiesInAudit,
  resolveActor,
  sortAuditsChronologically,
  UnknownZendeskStatusError,
  zendeskConditionAttributes,
  type AuditRecord,
  type DerivedNormalizedEvent,
} from "../src/normalize";
import type { ZendeskAudit, ZendeskTicket } from "../src/types";

const ticket: ZendeskTicket = {
  id: 42,
  url: "https://acme.zendesk.com/api/v2/tickets/42.json",
  external_id: null,
  subject: "Cannot log in to account",
  created_at: "2026-01-01T09:00:00Z",
  updated_at: "2026-01-03T12:00:00Z",
  status: "closed",
  priority: "high",
  organization_id: 7,
  requester_id: 501,
  via: { channel: "web" },
};

function audit(overrides: Partial<ZendeskAudit> & { id: number }): AuditRecord {
  return {
    rawEventId: `raw_${overrides.id}`,
    audit: {
      ticket_id: 42,
      created_at: "2026-01-01T09:00:00Z",
      author_id: 501,
      events: [],
      ...overrides,
    },
  };
}

function statusChange(value: string, previous_value: string) {
  return { id: 1, type: "Change", field_name: "status", value, previous_value };
}

function priorityChange(value: string | null, previous_value: string | null) {
  return { id: 2, type: "Change", field_name: "priority", value, previous_value };
}

describe("normalizeZendeskPriority", () => {
  it("is the identity mapping onto CanonicalPriority", () => {
    expect(normalizeZendeskPriority("low")).toBe("low");
    expect(normalizeZendeskPriority("normal")).toBe("normal");
    expect(normalizeZendeskPriority("high")).toBe("high");
    expect(normalizeZendeskPriority("urgent")).toBe("urgent");
  });

  it("maps an unset or unrecognized priority to null instead of leaking a raw string", () => {
    expect(normalizeZendeskPriority(null)).toBeNull();
    expect(normalizeZendeskPriority(undefined)).toBeNull();
    expect(normalizeZendeskPriority("bogus")).toBeNull();
  });
});

describe("normalizeZendeskStatus", () => {
  it("maps every known Zendesk status", () => {
    expect(normalizeZendeskStatus("new")).toBe("new");
    expect(normalizeZendeskStatus("open")).toBe("open");
    expect(normalizeZendeskStatus("pending")).toBe("pending_customer");
    expect(normalizeZendeskStatus("hold")).toBe("pending_internal");
    expect(normalizeZendeskStatus("solved")).toBe("resolved");
    expect(normalizeZendeskStatus("closed")).toBe("closed");
  });

  it("throws a named error on an unrecognized status", () => {
    expect(() => normalizeZendeskStatus("bogus")).toThrow(UnknownZendeskStatusError);
  });
});

describe("resolveActor", () => {
  it("attributes a trigger/automation/rule channel to the system, regardless of author", () => {
    expect(resolveActor("trigger", 501, ticket)).toBe("system");
    expect(resolveActor("automation", 999, ticket)).toBe("system");
    expect(resolveActor("rule", 999, ticket)).toBe("system");
  });

  it("attributes the ticket's requester to the customer", () => {
    expect(resolveActor("web", 501, ticket)).toBe("customer");
  });

  it("defaults to agent for anyone else", () => {
    expect(resolveActor("web", 999, ticket)).toBe("agent");
  });

  it("defaults to agent when the requester is unknown", () => {
    expect(resolveActor("web", 501, { ...ticket, requester_id: null })).toBe("agent");
  });

  describe("with Zendesk user roles", () => {
    const roles = new Map([
      [501, "agent"],
      [502, "admin"],
      [900, "end-user"],
    ] as const);

    it("attributes an agent to agent even when they are the ticket's requester", () => {
      expect(resolveActor("web", 501, ticket, roles)).toBe("agent");
    });

    it("attributes an admin to agent", () => {
      expect(resolveActor("web", 502, ticket, roles)).toBe("agent");
    });

    it("attributes an end user to customer even when they are not the requester", () => {
      expect(resolveActor("web", 900, ticket, roles)).toBe("customer");
    });

    it("still lets a system channel win over the author's role", () => {
      expect(resolveActor("trigger", 501, ticket, roles)).toBe("system");
      expect(resolveActor("rule", 900, ticket, roles)).toBe("system");
    });

    it("falls back to the requester comparison for an author whose role is unknown", () => {
      expect(resolveActor("web", 777, { ...ticket, requester_id: 777 }, roles)).toBe("customer");
      expect(resolveActor("web", 778, ticket, roles)).toBe("agent");
    });
  });
});

describe("sortAuditsChronologically", () => {
  it("orders by created_at, then by audit id as a tiebreaker", () => {
    const a = audit({ id: 3, created_at: "2026-01-01T10:00:00Z" });
    const b = audit({ id: 1, created_at: "2026-01-01T09:00:00Z" });
    const c = audit({ id: 2, created_at: "2026-01-01T09:00:00Z" });
    expect(sortAuditsChronologically([a, b, c]).map((r) => r.rawEventId)).toEqual([
      "raw_1",
      "raw_2",
      "raw_3",
    ]);
  });
});

describe("deriveNormalizedEventsForTicket", () => {
  it("synthesizes case_created from the ticket snapshot when there are no audits", () => {
    const events = deriveNormalizedEventsForTicket({ ...ticket, status: "new" }, [], "raw_ticket_42");
    expect(events).toEqual([
      {
        type: "case_created",
        occurredAt: ticket.created_at,
        actor: "customer",
        fromState: null,
        toState: "new",
        sourceRawEventId: "raw_ticket_42",
        sourceSequence: 0,
      },
    ]);
  });

  it("takes the initial state from the first status Change event's previous_value", () => {
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        author_id: 501,
        via: { channel: "web" },
        events: [statusChange("open", "new")],
      }),
    ];
    const events = deriveNormalizedEventsForTicket({ ...ticket, status: "open" }, audits, "raw_ticket_42");
    expect(events[0]).toMatchObject({ type: "case_created", fromState: null, toState: "new" });
    expect(events[1]).toMatchObject({
      type: "state_changed",
      fromState: "new",
      toState: "open",
      sourceRawEventId: "raw_1",
    });
  });

  it("emits case_closed instead of state_changed for the transition into solved or closed", () => {
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        author_id: 501,
        via: { channel: "web" },
        events: [statusChange("open", "new")],
      }),
      audit({
        id: 2,
        created_at: "2026-01-02T09:00:00Z",
        author_id: 900,
        via: { channel: "web" },
        events: [statusChange("solved", "open")],
      }),
      audit({
        id: 3,
        created_at: "2026-01-03T12:00:00Z",
        author_id: 900,
        via: { channel: "trigger" },
        events: [statusChange("closed", "solved")],
      }),
    ];
    const events = deriveNormalizedEventsForTicket(ticket, audits, "raw_ticket_42");

    expect(events.map((e) => e.type)).toEqual([
      "case_created",
      "state_changed",
      "case_closed",
      "case_closed",
    ]);
    const solved = events[2];
    expect(solved).toMatchObject({
      type: "case_closed",
      fromState: "open",
      toState: "resolved",
      actor: "agent",
      sourceRawEventId: "raw_2",
    });
    const closed = events[3];
    expect(closed).toMatchObject({
      type: "case_closed",
      fromState: "resolved",
      toState: "closed",
      actor: "system",
      sourceRawEventId: "raw_3",
    });
  });

  it("emits a plain state_changed when a solved ticket is reopened", () => {
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        author_id: 501,
        via: { channel: "web" },
        events: [statusChange("open", "new")],
      }),
      audit({
        id: 2,
        created_at: "2026-01-02T09:00:00Z",
        author_id: 900,
        via: { channel: "web" },
        events: [statusChange("solved", "open")],
      }),
      audit({
        id: 3,
        created_at: "2026-01-02T15:00:00Z",
        author_id: 501,
        via: { channel: "web" },
        events: [statusChange("open", "solved")],
      }),
    ];
    const events = deriveNormalizedEventsForTicket({ ...ticket, status: "open" }, audits, "raw_ticket_42");

    expect(events.map((e) => e.type)).toEqual(["case_created", "state_changed", "case_closed", "state_changed"]);
    expect(events[3]).toMatchObject({ type: "state_changed", fromState: "resolved", toState: "open" });
  });

  it("resolves each transition's actor independently from its own audit", () => {
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        author_id: 501, // the requester
        via: { channel: "web" },
        events: [statusChange("open", "new")],
      }),
      audit({
        id: 2,
        created_at: "2026-01-02T09:00:00Z",
        author_id: 900, // an agent
        via: { channel: "web" },
        events: [statusChange("pending", "open")],
      }),
    ];
    const events = deriveNormalizedEventsForTicket({ ...ticket, status: "pending" }, audits, "raw_ticket_42");
    expect(events[1]?.actor).toBe("customer");
    expect(events[2]?.actor).toBe("agent");
  });

  it("ignores Change events on fields other than status/priority, and other event types", () => {
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        events: [
          { id: 1, type: "Change", field_name: "group_id", value: "9", previous_value: "3" },
          { id: 2, type: "Comment", body: "looking into it" },
        ],
      }),
    ];
    const events = deriveNormalizedEventsForTicket({ ...ticket, status: "new" }, audits, "raw_ticket_42");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("case_created");
  });

  it("emits priority_changed for a priority Change event, display-only", () => {
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        author_id: 501,
        via: { channel: "web" },
        events: [priorityChange("urgent", "high")],
      }),
    ];
    const events = deriveNormalizedEventsForTicket({ ...ticket, status: "new" }, audits, "raw_ticket_42");
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "priority_changed",
      fromState: "high",
      toState: "urgent",
      actor: "customer",
      sourceRawEventId: "raw_1",
    });
  });

  it("emits priority_changed with a null side when priority is unset", () => {
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        author_id: 501,
        via: { channel: "web" },
        events: [priorityChange(null, "low")],
      }),
    ];
    const events = deriveNormalizedEventsForTicket({ ...ticket, status: "new" }, audits, "raw_ticket_42");
    expect(events[1]).toMatchObject({ type: "priority_changed", fromState: "low", toState: null });
  });

  it("never carries a non-canonical priority string on priority_changed", () => {
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        author_id: 501,
        via: { channel: "web" },
        events: [priorityChange("bogus", "normal")],
      }),
    ];
    const events = deriveNormalizedEventsForTicket({ ...ticket, status: "new" }, audits, "raw_ticket_42");
    expect(events[1]).toMatchObject({ type: "priority_changed", fromState: "normal", toState: null });
  });
});

describe("deriveCaseClosedAt", () => {
  const solvedEvent: DerivedNormalizedEvent = {
    type: "case_closed",
    occurredAt: "2026-01-02T09:00:00Z",
    actor: "agent",
    fromState: "open",
    toState: "resolved",
    sourceRawEventId: "raw_2",
  };
  const closedEvent: DerivedNormalizedEvent = {
    type: "case_closed",
    occurredAt: "2026-01-03T12:00:00Z",
    actor: "system",
    fromState: "resolved",
    toState: "closed",
    sourceRawEventId: "raw_3",
  };
  const createdEvent: DerivedNormalizedEvent = {
    type: "case_created",
    occurredAt: "2026-01-01T09:00:00Z",
    actor: "customer",
    fromState: null,
    toState: "open",
    sourceRawEventId: "raw_ticket_42",
  };

  it("is set from the solved transition when the ticket is currently solved", () => {
    const closedAt = deriveCaseClosedAt({ ...ticket, status: "solved" }, [createdEvent, solvedEvent]);
    expect(closedAt?.toISOString()).toBe("2026-01-02T09:00:00.000Z");
  });

  it("is set from the closed transition when the ticket is currently closed", () => {
    const closedAt = deriveCaseClosedAt({ ...ticket, status: "closed" }, [createdEvent, solvedEvent, closedEvent]);
    expect(closedAt?.toISOString()).toBe("2026-01-03T12:00:00.000Z");
  });

  it("is null for an open, pending, new, or on-hold ticket", () => {
    for (const status of ["new", "open", "pending", "hold"]) {
      expect(deriveCaseClosedAt({ ...ticket, status }, [createdEvent])).toBeNull();
    }
  });

  it("is null again once a solved ticket is reopened, even though a case_closed event exists in its history", () => {
    const reopened: DerivedNormalizedEvent = {
      type: "state_changed",
      occurredAt: "2026-01-02T15:00:00Z",
      actor: "customer",
      fromState: "resolved",
      toState: "open",
      sourceRawEventId: "raw_4",
    };
    const closedAt = deriveCaseClosedAt({ ...ticket, status: "open" }, [createdEvent, solvedEvent, reopened]);
    expect(closedAt).toBeNull();
  });

  it("falls back to the ticket's updated_at when no case_closed event was derived", () => {
    const closedAt = deriveCaseClosedAt({ ...ticket, status: "solved", updated_at: "2026-01-05T00:00:00Z" }, [
      { ...createdEvent, toState: "resolved" },
    ]);
    expect(closedAt?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("uses the most recent case_closed event when the ticket was solved more than once", () => {
    const secondSolve: DerivedNormalizedEvent = {
      type: "case_closed",
      occurredAt: "2026-01-04T10:00:00Z",
      actor: "agent",
      fromState: "open",
      toState: "resolved",
      sourceRawEventId: "raw_5",
    };
    const closedAt = deriveCaseClosedAt({ ...ticket, status: "solved" }, [createdEvent, solvedEvent, secondSolve]);
    expect(closedAt?.toISOString()).toBe("2026-01-04T10:00:00.000Z");
  });

  it("is idempotent: re-deriving from the same solved ticket and audits twice yields identical output", () => {
    const solvedTicket = { ...ticket, status: "solved" };
    const audits = [
      audit({
        id: 1,
        created_at: "2026-01-01T09:05:00Z",
        author_id: 501,
        via: { channel: "web" },
        events: [statusChange("open", "new")],
      }),
      audit({
        id: 2,
        created_at: "2026-01-02T09:00:00Z",
        author_id: 900,
        via: { channel: "web" },
        events: [statusChange("solved", "open")],
      }),
    ];

    const run = () => {
      const derived = deriveNormalizedEventsForTicket(solvedTicket, audits, "raw_ticket_42");
      return { derived, closedAt: deriveCaseClosedAt(solvedTicket, derived) };
    };

    const first = run();
    const second = run();
    expect(second.derived).toEqual(first.derived);
    expect(second.closedAt?.toISOString()).toBe(first.closedAt?.toISOString());
    expect(first.derived.map((e) => e.type)).toEqual(["case_created", "state_changed", "case_closed"]);
  });
});

describe("deriveNormalizedEventsForTicket agent replies", () => {
  const openTicket: ZendeskTicket = { ...ticket, status: "open" };

  function comment(overrides: Record<string, unknown> = {}) {
    return { id: 9, type: "Comment", public: true, body: "hello", ...overrides };
  }

  const replies = (events: DerivedNormalizedEvent[]) => events.filter((e) => e.type === "agent_replied");

  it("emits agent_replied for a public comment by someone other than the requester", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [audit({ id: 2, created_at: "2026-01-01T09:40:00Z", author_id: 900, events: [comment({ author_id: 900 })] })],
      "raw_ticket",
    );
    expect(replies(events)).toEqual([
      {
        type: "agent_replied",
        occurredAt: "2026-01-01T09:40:00Z",
        actor: "agent",
        fromState: null,
        toState: null,
        sourceRawEventId: "raw_2",
        sourceSequence: 1,
      },
    ]);
  });

  it("ignores the ticket's own description, even when an agent opened the ticket", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [audit({ id: 1, created_at: openTicket.created_at, author_id: 900, events: [comment({ author_id: 900 })] })],
      "raw_ticket",
    );
    expect(replies(events)).toEqual([]);
  });

  it("ignores customer comments, private notes, and trigger/automation comments", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [
        audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: 501, events: [comment({ author_id: 501 })] }),
        audit({ id: 3, created_at: "2026-01-01T09:20:00Z", author_id: 900, events: [comment({ author_id: 900, public: false })] }),
        audit({
          id: 4,
          created_at: "2026-01-01T09:30:00Z",
          author_id: -1,
          via: { channel: "rule" },
          events: [comment({ author_id: -1 })],
        }),
      ],
      "raw_ticket",
    );
    expect(replies(events)).toEqual([]);
  });

  it("emits no replies when the ticket's requester is unknown", () => {
    const events = deriveNormalizedEventsForTicket(
      { ...openTicket, requester_id: null },
      [audit({ id: 2, created_at: "2026-01-01T09:40:00Z", author_id: 900, events: [comment({ author_id: 900 })] })],
      "raw_ticket",
    );
    expect(replies(events)).toEqual([]);
  });

  describe("classified by the author's Zendesk role", () => {
    const AGENT_A = 501; // the ticket's requester in these tests
    const AGENT_B = 502;
    const END_USER = 900;
    const roles = new Map([
      [AGENT_A, "agent"],
      [AGENT_B, "admin"],
      [END_USER, "end-user"],
    ] as const);

    it("emits agent_replied when the agent who is the requester replies", () => {
      const events = deriveNormalizedEventsForTicket(
        { ...openTicket, requester_id: AGENT_A, assignee_id: AGENT_B },
        [audit({ id: 2, created_at: "2026-01-01T09:40:00Z", author_id: AGENT_A, events: [comment({ author_id: AGENT_A })] })],
        "raw_ticket",
        roles,
      );
      expect(replies(events)).toMatchObject([{ occurredAt: "2026-01-01T09:40:00Z", actor: "agent", sourceRawEventId: "raw_2" }]);
    });

    it("emits agent_replied when a different agent replies on an agent-requested ticket", () => {
      const events = deriveNormalizedEventsForTicket(
        { ...openTicket, requester_id: AGENT_A },
        [audit({ id: 2, created_at: "2026-01-01T09:40:00Z", author_id: AGENT_B, events: [comment({ author_id: AGENT_B })] })],
        "raw_ticket",
        roles,
      );
      expect(replies(events)).toMatchObject([{ occurredAt: "2026-01-01T09:40:00Z", actor: "agent" }]);
    });

    it("emits no agent_replied when the end user who is the requester replies", () => {
      const events = deriveNormalizedEventsForTicket(
        { ...openTicket, requester_id: END_USER },
        [audit({ id: 2, created_at: "2026-01-01T09:40:00Z", author_id: END_USER, events: [comment({ author_id: END_USER })] })],
        "raw_ticket",
        roles,
      );
      expect(replies(events)).toEqual([]);
    });

    it("emits no agent_replied for an end user who is not the requester (e.g. a CC)", () => {
      const events = deriveNormalizedEventsForTicket(
        { ...openTicket, requester_id: AGENT_A },
        [audit({ id: 2, created_at: "2026-01-01T09:40:00Z", author_id: END_USER, events: [comment({ author_id: END_USER })] })],
        "raw_ticket",
        roles,
      );
      expect(replies(events)).toEqual([]);
    });

    it("ignores an agent's own ticket description on the creation audit", () => {
      const events = deriveNormalizedEventsForTicket(
        { ...openTicket, requester_id: AGENT_A },
        [audit({ id: 1, created_at: openTicket.created_at, author_id: AGENT_A, events: [comment({ author_id: AGENT_A })] })],
        "raw_ticket",
        roles,
      );
      expect(replies(events)).toEqual([]);
    });

    it("ignores private notes and trigger/automation comments even from agents", () => {
      const events = deriveNormalizedEventsForTicket(
        openTicket,
        [
          audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: AGENT_A, events: [comment({ author_id: AGENT_A, public: false })] }),
          audit({ id: 3, created_at: "2026-01-01T09:20:00Z", author_id: AGENT_B, via: { channel: "rule" }, events: [comment({ author_id: AGENT_B })] }),
        ],
        "raw_ticket",
        roles,
      );
      expect(replies(events)).toEqual([]);
    });

    it("emits agent_replied by role even when the requester is unknown", () => {
      const events = deriveNormalizedEventsForTicket(
        { ...openTicket, requester_id: null },
        [audit({ id: 2, created_at: "2026-01-01T09:40:00Z", author_id: AGENT_B, events: [comment({ author_id: AGENT_B })] })],
        "raw_ticket",
        roles,
      );
      expect(replies(events)).toHaveLength(1);
    });
  });

  it("keeps events in chronological order, and in the audit's own event order within an audit", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [
        audit({ id: 3, created_at: "2026-01-01T10:00:00Z", author_id: 900, events: [statusChange("open", "pending")] }),
        audit({
          id: 2,
          created_at: "2026-01-01T09:40:00Z",
          author_id: 900,
          events: [comment({ author_id: 900 }), statusChange("pending", "new")],
        }),
      ],
      "raw_ticket",
    );
    expect(events.map((e) => [e.type, e.occurredAt])).toEqual([
      ["case_created", "2026-01-01T09:00:00Z"],
      ["agent_replied", "2026-01-01T09:40:00Z"],
      ["state_changed", "2026-01-01T09:40:00Z"],
      ["state_changed", "2026-01-01T10:00:00Z"],
    ]);
  });
});

/**
 * Regression: Zendesk ticket 51 as actually ingested. The agent who created
 * it is also its requester (and assignee), so the old requester-based guess
 * called their "asd" reply a customer comment and First Response breached.
 */
describe("deriveNormalizedEventsForTicket ticket 51 regression", () => {
  const AGENT = 38669107468434;
  const ticket51: ZendeskTicket = {
    ...ticket,
    id: 51,
    subject: "ticket#51",
    created_at: "2026-09-17T10:32:43Z",
    updated_at: "2026-09-17T10:34:25Z",
    status: "solved",
    priority: "urgent",
    requester_id: AGENT,
    submitter_id: AGENT,
    assignee_id: AGENT,
  };
  const audits51: AuditRecord[] = [
    {
      rawEventId: "cmu5e551902ka14ryto7on7e1",
      audit: {
        id: 39019693023378,
        ticket_id: 51,
        created_at: "2026-09-17T10:32:43Z",
        author_id: AGENT,
        via: { channel: "web" },
        events: [
          { id: 39019693023506, type: "Comment", public: true, body: "ticket#50", author_id: AGENT },
          { id: 39019693024146, type: "Create", field_name: "status", value: "open" },
        ],
      },
    },
    {
      rawEventId: "cmu5e551902kb14ryvvvidlqk",
      audit: {
        id: 39019715177618,
        ticket_id: 51,
        created_at: "2026-09-17T10:32:43Z",
        author_id: -1,
        via: { channel: "sla" },
        events: [{ id: 39019693061138, type: "Change", field_name: "total_resolution_time", value: { minutes: 240 }, previous_value: null }],
      },
    },
    {
      rawEventId: "cmu5e5zon02og14ryo9w4q25x",
      audit: {
        id: 39019723346834,
        ticket_id: 51,
        created_at: "2026-09-17T10:33:23Z",
        author_id: AGENT,
        via: { channel: "web" },
        events: [{ id: 39019723347090, type: "Change", field_name: "subject", value: "ticket#51", previous_value: "ticket#50" }],
      },
    },
    {
      rawEventId: "cmu5e7bdt02sl14ry0woq5z2y",
      audit: {
        id: 39019734767762,
        ticket_id: 51,
        created_at: "2026-09-17T10:33:26Z",
        author_id: AGENT,
        via: { channel: "web" },
        events: [
          { id: 39019740503570, type: "Comment", public: true, body: "asd", author_id: AGENT },
          { id: 39019740504338, type: "Notification", via: { channel: "rule" }, recipients: [AGENT] },
        ],
      },
    },
    {
      rawEventId: "cmu5e7bdt02sm14ryke6hgtfp",
      audit: {
        id: 39019768686098,
        ticket_id: 51,
        created_at: "2026-09-17T10:34:25Z",
        author_id: AGENT,
        via: { channel: "web" },
        events: [{ id: 39019768686226, type: "Change", field_name: "status", value: "solved", previous_value: "open" }],
      },
    },
  ];

  it("emits agent_replied at 10:33:26Z for the agent-requester's reply, and not for the description", () => {
    const events = deriveNormalizedEventsForTicket(ticket51, audits51, "raw_ticket_51", new Map([[AGENT, "agent"]]));
    expect(events.map((e) => [e.type, e.occurredAt, e.actor])).toEqual([
      ["case_created", "2026-09-17T10:32:43Z", "agent"],
      ["agent_replied", "2026-09-17T10:33:26Z", "agent"],
      ["case_closed", "2026-09-17T10:34:25Z", "agent"],
    ]);
    expect(events[1]?.sourceRawEventId).toBe("cmu5e7bdt02sl14ry0woq5z2y");
  });

  it("keeps the solve as the only case_closed, unchanged by the author's role", () => {
    const withRoles = deriveNormalizedEventsForTicket(ticket51, audits51, "raw_ticket_51", new Map([[AGENT, "agent"]]));
    const withoutRoles = deriveNormalizedEventsForTicket(ticket51, audits51, "raw_ticket_51");
    const closures = (events: DerivedNormalizedEvent[]) =>
      events.filter((e) => e.type === "case_closed").map(({ actor: _actor, ...rest }) => rest);
    expect(closures(withRoles)).toEqual(closures(withoutRoles));
  });
});

describe("deriveNormalizedEventsForTicket source ordering", () => {
  const openTicket: ZendeskTicket = { ...ticket, status: "open" };
  const AGENT = 900;
  const SAME_SECOND = "2026-01-01T10:00:00Z";

  function agentComment() {
    return { id: 9, type: "Comment", public: true, body: "hello", author_id: AGENT };
  }

  const summarize = (events: DerivedNormalizedEvent[]) =>
    events.map((e) => `${e.sourceRawEventId}:${e.type}${e.toState ? `→${e.toState}` : ""}`);

  it("keeps a comment listed before a status change in the same audit before it", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [
        audit({
          id: 101,
          created_at: SAME_SECOND,
          author_id: AGENT,
          events: [agentComment(), statusChange("solved", "open")],
        }),
      ],
      "raw_ticket",
    );

    expect(summarize(events)).toEqual(["raw_101:case_created→open", "raw_101:agent_replied", "raw_101:case_closed→resolved"]);
    const [, reply, solve] = events;
    expect(reply!.occurredAt).toBe(solve!.occurredAt);
    expect(reply!.sourceSequence).toBeLessThan(solve!.sourceSequence);
  });

  it("preserves audit order and in-audit event order across same-second audits, instead of grouping status changes before comments", () => {
    const audits = [
      audit({
        id: 101,
        created_at: SAME_SECOND,
        author_id: AGENT,
        events: [agentComment(), statusChange("pending", "open")],
      }),
      audit({
        id: 102,
        created_at: SAME_SECOND,
        author_id: AGENT,
        events: [statusChange("open", "pending"), agentComment()],
      }),
    ];
    const events = deriveNormalizedEventsForTicket(openTicket, audits, "raw_ticket");

    expect(summarize(events)).toEqual([
      "raw_101:case_created→open",
      "raw_101:agent_replied",
      "raw_101:state_changed→pending_customer",
      "raw_102:state_changed→open",
      "raw_102:agent_replied",
    ]);
    const sequences = events.map((e) => e.sourceSequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it("orders same-second audits by audit id regardless of the order they were loaded in", () => {
    const audits = [
      audit({ id: 102, created_at: SAME_SECOND, author_id: AGENT, events: [statusChange("open", "pending")] }),
      audit({ id: 101, created_at: SAME_SECOND, author_id: AGENT, events: [agentComment(), statusChange("pending", "open")] }),
    ];
    const events = deriveNormalizedEventsForTicket(openTicket, audits, "raw_ticket");
    expect(summarize(events)).toEqual([
      "raw_101:case_created→open",
      "raw_101:agent_replied",
      "raw_101:state_changed→pending_customer",
      "raw_102:state_changed→open",
    ]);
  });

  it("counts every audit event toward the sequence, including ones that emit nothing", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [
        audit({
          id: 101,
          created_at: SAME_SECOND,
          author_id: AGENT,
          events: [
            { id: 1, type: "Notification" },
            { id: 2, type: "Comment", public: false, author_id: AGENT },
            agentComment(),
          ],
        }),
      ],
      "raw_ticket",
    );
    expect(events.find((e) => e.type === "agent_replied")?.sourceSequence).toBe(3);
  });

  it("is idempotent: repeated normalization of the same audits, in any load order, yields identical events and sequences", () => {
    const audits = [
      audit({ id: 100, created_at: "2026-01-01T09:05:00Z", author_id: AGENT, events: [statusChange("open", "new")] }),
      audit({ id: 101, created_at: SAME_SECOND, author_id: AGENT, events: [agentComment(), statusChange("pending", "open")] }),
      audit({ id: 102, created_at: SAME_SECOND, author_id: 501, events: [statusChange("open", "pending")] }),
      audit({ id: 103, created_at: "2026-01-01T11:00:00Z", author_id: AGENT, events: [agentComment(), statusChange("solved", "open")] }),
    ];
    const first = deriveNormalizedEventsForTicket(openTicket, audits, "raw_ticket");
    const again = deriveNormalizedEventsForTicket(openTicket, audits, "raw_ticket");
    const reversed = deriveNormalizedEventsForTicket(openTicket, [...audits].reverse(), "raw_ticket");
    const rotated = deriveNormalizedEventsForTicket(openTicket, [...audits.slice(2), ...audits.slice(0, 2)], "raw_ticket");

    expect(again).toEqual(first);
    expect(reversed).toEqual(first);
    expect(rotated).toEqual(first);
  });
});

describe("deriveNormalizedEventsForTicket customer replies", () => {
  const openTicket: ZendeskTicket = { ...ticket, status: "open" };
  const CUSTOMER = 501; // the ticket's requester
  const AGENT = 900;

  function comment(overrides: Record<string, unknown> = {}) {
    return { id: 9, type: "Comment", public: true, body: "hello", ...overrides };
  }

  const replyEvents = (events: DerivedNormalizedEvent[]) =>
    events
      .filter((e) => e.type === "customer_replied" || e.type === "agent_replied")
      .map((e) => [e.type, e.occurredAt, e.actor, e.sourceRawEventId]);

  it("keeps both a customer comment and the agent's public reply", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [
        audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: CUSTOMER, events: [comment({ author_id: CUSTOMER })] }),
        audit({ id: 3, created_at: "2026-01-01T09:40:00Z", author_id: AGENT, events: [comment({ author_id: AGENT })] }),
      ],
      "raw_ticket",
    );
    expect(events.find((e) => e.type === "customer_replied")).toEqual({
      type: "customer_replied",
      occurredAt: "2026-01-01T09:10:00Z",
      actor: "customer",
      fromState: null,
      toState: null,
      sourceRawEventId: "raw_2",
      sourceSequence: 1,
    });
    expect(replyEvents(events)).toEqual([
      ["customer_replied", "2026-01-01T09:10:00Z", "customer", "raw_2"],
      ["agent_replied", "2026-01-01T09:40:00Z", "agent", "raw_3"],
    ]);
  });

  it("does not turn an internal note between them into a customer reply", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [
        audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: CUSTOMER, events: [comment({ author_id: CUSTOMER })] }),
        audit({ id: 3, created_at: "2026-01-01T09:20:00Z", author_id: AGENT, events: [comment({ author_id: AGENT, public: false })] }),
        audit({ id: 4, created_at: "2026-01-01T09:40:00Z", author_id: AGENT, events: [comment({ author_id: AGENT })] }),
      ],
      "raw_ticket",
    );
    expect(events.map((e) => e.type)).toEqual(["case_created", "customer_replied", "agent_replied"]);
    expect(replyEvents(events)).toEqual([
      ["customer_replied", "2026-01-01T09:10:00Z", "customer", "raw_2"],
      ["agent_replied", "2026-01-01T09:40:00Z", "agent", "raw_4"],
    ]);
  });

  it("ignores a private comment even when the customer authored it", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: CUSTOMER, events: [comment({ author_id: CUSTOMER, public: false })] })],
      "raw_ticket",
    );
    expect(replyEvents(events)).toEqual([]);
  });

  it("ignores the customer's own ticket description on the creation audit", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [audit({ id: 1, created_at: openTicket.created_at, author_id: CUSTOMER, events: [comment({ author_id: CUSTOMER })] })],
      "raw_ticket",
    );
    expect(replyEvents(events)).toEqual([]);
  });

  it("ignores trigger/automation comments posted as the requester", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [
        audit({
          id: 2,
          created_at: "2026-01-01T09:10:00Z",
          author_id: CUSTOMER,
          via: { channel: "trigger" },
          events: [comment({ author_id: CUSTOMER })],
        }),
      ],
      "raw_ticket",
    );
    expect(replyEvents(events)).toEqual([]);
  });

  it("emits no customer reply when neither the author's role nor the requester is known", () => {
    const events = deriveNormalizedEventsForTicket(
      { ...openTicket, requester_id: null },
      [audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: CUSTOMER, events: [comment({ author_id: CUSTOMER })] })],
      "raw_ticket",
    );
    expect(replyEvents(events)).toEqual([]);
  });

  it("classifies by Zendesk role: an end user who is not the requester (a CC) is a customer reply", () => {
    const roles = new Map([
      [502, "agent"],
      [777, "end-user"],
    ] as const);
    const events = deriveNormalizedEventsForTicket(
      { ...openTicket, requester_id: 502 },
      [audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: 777, events: [comment({ author_id: 777 })] })],
      "raw_ticket",
      roles,
    );
    expect(replyEvents(events)).toEqual([["customer_replied", "2026-01-01T09:10:00Z", "customer", "raw_2"]]);
  });

  it("keeps a customer comment and a status change in the same audit in audit order", () => {
    const events = deriveNormalizedEventsForTicket(
      openTicket,
      [
        audit({
          id: 2,
          created_at: "2026-01-01T09:10:00Z",
          author_id: CUSTOMER,
          events: [statusChange("open", "pending"), comment({ author_id: CUSTOMER })],
        }),
      ],
      "raw_ticket",
    );
    expect(events.map((e) => [e.type, e.sourceSequence])).toEqual([
      ["case_created", 0],
      ["state_changed", 1],
      ["customer_replied", 2],
    ]);
  });
});

describe("Next Reply cycles from derived ticket events", () => {
  const openTicket: ZendeskTicket = { ...ticket, status: "open" };
  const CUSTOMER = 501; // the ticket's requester
  const AGENT = 900;
  const AS_OF = "2026-01-02T00:00:00.000Z";

  const publicComment = (authorId: number, overrides: Record<string, unknown> = {}) => ({
    id: 9,
    type: "Comment",
    public: true,
    body: "hello",
    author_id: authorId,
    ...overrides,
  });

  const toCoreEvents = (derived: DerivedNormalizedEvent[]): NormalizedEvent[] =>
    derived.map((event, i) => ({ ...event, id: `evt-${i}`, caseId: "case-42", system: "zendesk", sourceRole: "ticket_source" as const }));

  const cycles = (events: NormalizedEvent[]) =>
    deriveNextReplyCycles(events, { asOf: AS_OF, firstResponseCompletion: findFirstResponseEvent(events, AS_OF) }).map(
      (c) => [c.startedAt, c.completedAt, c.customerReplies.map((r) => r.sourceRawEventId)],
    );

  it("derives cycles past notes, triggers, pending, repeated agent replies, and a solve/reopen", () => {
    const events = toCoreEvents(
      deriveNormalizedEventsForTicket(
        openTicket,
        [
          // Covered by first response.
          audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: CUSTOMER, events: [publicComment(CUSTOMER)] }),
          audit({ id: 3, created_at: "2026-01-01T09:20:00Z", author_id: AGENT, events: [publicComment(AGENT, { public: false })] }),
          audit({
            id: 4,
            created_at: "2026-01-01T09:30:00Z",
            author_id: AGENT,
            events: [publicComment(AGENT), statusChange("pending", "open")],
          }),
          // Cycle 1: two customer replies around a trigger comment, answered once.
          audit({
            id: 5,
            created_at: "2026-01-01T09:40:00Z",
            author_id: CUSTOMER,
            events: [publicComment(CUSTOMER), statusChange("open", "pending")],
          }),
          audit({ id: 6, created_at: "2026-01-01T09:45:00Z", author_id: AGENT, via: { channel: "trigger" }, events: [publicComment(AGENT)] }),
          audit({ id: 7, created_at: "2026-01-01T09:50:00Z", author_id: CUSTOMER, events: [publicComment(CUSTOMER)] }),
          audit({ id: 8, created_at: "2026-01-01T10:00:00Z", author_id: AGENT, events: [publicComment(AGENT)] }),
          audit({ id: 9, created_at: "2026-01-01T10:05:00Z", author_id: AGENT, events: [publicComment(AGENT)] }),
          audit({ id: 10, created_at: "2026-01-01T10:10:00Z", author_id: AGENT, events: [statusChange("solved", "open")] }),
          // Cycle 2: the customer reopens by replying; nobody has answered yet.
          audit({
            id: 11,
            created_at: "2026-01-01T10:20:00Z",
            author_id: CUSTOMER,
            events: [publicComment(CUSTOMER), statusChange("open", "solved")],
          }),
        ],
        "raw_ticket",
      ),
    );

    expect(cycles(events)).toEqual([
      ["2026-01-01T09:40:00.000Z", "2026-01-01T10:00:00.000Z", ["raw_5", "raw_7"]],
      ["2026-01-01T10:20:00.000Z", null, ["raw_11"]],
    ]);
  });

  it("orders same-second customer and agent audits by audit id", () => {
    const firstReply = audit({ id: 2, created_at: "2026-01-01T09:10:00Z", author_id: AGENT, events: [publicComment(AGENT)] });
    const customerAudit = (id: number) =>
      audit({ id, created_at: "2026-01-01T09:30:00Z", author_id: CUSTOMER, events: [publicComment(CUSTOMER)] });
    const agentAudit = (id: number) =>
      audit({ id, created_at: "2026-01-01T09:30:00Z", author_id: AGENT, events: [publicComment(AGENT)] });

    const answered = toCoreEvents(deriveNormalizedEventsForTicket(openTicket, [firstReply, customerAudit(3), agentAudit(4)], "raw_ticket"));
    expect(cycles(answered)).toEqual([["2026-01-01T09:30:00.000Z", "2026-01-01T09:30:00.000Z", ["raw_3"]]]);

    const unanswered = toCoreEvents(deriveNormalizedEventsForTicket(openTicket, [firstReply, agentAudit(3), customerAudit(4)], "raw_ticket"));
    expect(cycles(unanswered)).toEqual([["2026-01-01T09:30:00.000Z", null, ["raw_4"]]]);
  });
});

describe("publicCommentBodiesInAudit", () => {
  it("extracts a public comment's text and author id", () => {
    const result = publicCommentBodiesInAudit({
      ticket_id: 42,
      created_at: "2026-01-01T09:40:00Z",
      author_id: 900,
      events: [{ id: 9, type: "Comment", public: true, body: "Any update?", author_id: 900 }],
    });
    expect(result).toEqual([{ id: 9, authorId: 900, body: "Any update?" }]);
  });

  it("prefers plain_body over body when both are present", () => {
    const result = publicCommentBodiesInAudit({
      ticket_id: 42,
      created_at: "2026-01-01T09:40:00Z",
      author_id: 900,
      events: [
        { id: 9, type: "Comment", public: true, body: "<p>hi</p>", plain_body: "hi", author_id: 900 },
      ],
    });
    expect(result).toEqual([{ id: 9, authorId: 900, body: "hi" }]);
  });

  it("falls back to the audit's own author_id when the event carries none", () => {
    const result = publicCommentBodiesInAudit({
      ticket_id: 42,
      created_at: "2026-01-01T09:40:00Z",
      author_id: 501,
      events: [{ id: 9, type: "Comment", public: true, body: "hello" }],
    });
    expect(result).toEqual([{ id: 9, authorId: 501, body: "hello" }]);
  });

  it("excludes private notes and non-comment events", () => {
    const result = publicCommentBodiesInAudit({
      ticket_id: 42,
      created_at: "2026-01-01T09:40:00Z",
      author_id: 900,
      events: [
        { id: 9, type: "Comment", public: false, body: "internal note", author_id: 900 },
        { id: 10, type: "Notification", author_id: 900 },
      ],
    });
    expect(result).toEqual([]);
  });

  it("excludes a public comment with no usable text", () => {
    const result = publicCommentBodiesInAudit({
      ticket_id: 42,
      created_at: "2026-01-01T09:40:00Z",
      author_id: 900,
      events: [{ id: 9, type: "Comment", public: true, body: "   ", author_id: 900 }],
    });
    expect(result).toEqual([]);
  });

  it("preserves audit event order for multiple public comments in one audit", () => {
    const result = publicCommentBodiesInAudit({
      ticket_id: 42,
      created_at: "2026-01-01T09:40:00Z",
      author_id: 900,
      events: [
        { id: 9, type: "Comment", public: true, body: "first", author_id: 900 },
        { id: 10, type: "Comment", public: true, body: "second", author_id: 501 },
      ],
    });
    expect(result).toEqual([
      { id: 9, authorId: 900, body: "first" },
      { id: 10, authorId: 501, body: "second" },
    ]);
  });
});

describe("zendeskConditionAttributes", () => {
  it("resolves every Zendesk SLA condition field this importer supports, minus the canonical Case columns", () => {
    const result = zendeskConditionAttributes({
      ...ticket,
      status: "pending",
      type: "incident",
      group_id: 42,
      assignee_id: 7,
      requester_id: 501,
      brand_id: 3,
      ticket_form_id: 99,
      recipient: "support@acme.com",
      via: { channel: "chat" },
      custom_fields: [
        { id: 360000123, value: "gold" },
        { id: 360000456, value: null },
      ],
    });

    expect(result).toEqual({
      status: "pending",
      type: "incident",
      group_id: 42,
      assignee_id: 7,
      requester_id: 501,
      brand_id: 3,
      ticket_form_id: 99,
      form_id: 99,
      recipient: "support@acme.com",
      via_id: "chat",
      current_via_id: "chat",
      exact_created_at: ticket.created_at,
      custom_fields_360000123: "gold",
      custom_fields_360000456: null,
    });
  });

  it("omits a field entirely when the ticket doesn't carry it, so the matcher's missing-field fail-safe applies", () => {
    const result = zendeskConditionAttributes(ticket);

    expect(result).toEqual({
      status: "closed",
      requester_id: 501,
      via_id: "web",
      current_via_id: "web",
      exact_created_at: ticket.created_at,
    });
    expect(result).not.toHaveProperty("type");
    expect(result).not.toHaveProperty("group_id");
    expect(result).not.toHaveProperty("assignee_id");
    expect(result).not.toHaveProperty("brand_id");
    expect(result).not.toHaveProperty("ticket_form_id");
    expect(result).not.toHaveProperty("recipient");
  });

  it("keys each custom field by its Zendesk id, including a null value", () => {
    const result = zendeskConditionAttributes({
      ...ticket,
      custom_fields: [{ id: 1, value: "a" }, { id: 2, value: 5 }, { id: 3, value: null }],
    });

    expect(result.custom_fields_1).toBe("a");
    expect(result.custom_fields_2).toBe(5);
    expect(result.custom_fields_3).toBeNull();
  });

  it("never emits organization_id, priority, or tags — those are resolved as canonical Case columns / match.customerIds elsewhere, never duplicated into the generic attributes bag", () => {
    const result = zendeskConditionAttributes(ticket);

    expect(result).not.toHaveProperty("organization_id");
    expect(result).not.toHaveProperty("priority");
    expect(result).not.toHaveProperty("tags");
  });
});

// H-11: case_created.actor is fixed at creation and never rewritten by later audits.
describe("deriveNormalizedEventsForTicket — creation actor (H-11)", () => {
  const CUSTOMER = 900;
  const AGENT_ID = 500;
  const roles = new Map<number, "end-user" | "agent">([
    [CUSTOMER, "end-user"],
    [AGENT_ID, "agent"],
  ]);
  const CREATED = "2026-09-28T10:55:08Z";

  const base = (over: Partial<ZendeskTicket> = {}): ZendeskTicket => ({
    ...ticket,
    id: 54,
    created_at: CREATED,
    status: "solved",
    requester_id: CUSTOMER,
    submitter_id: AGENT_ID,
    via: { channel: "web" },
    ...over,
  });

  // The creation audit carries Create events only (no status Change), like real Zendesk audits.
  const creationAudit = (authorId: number, id = 1): AuditRecord =>
    audit({
      id,
      created_at: CREATED,
      author_id: authorId,
      via: { channel: "web" },
      events: [{ id: id * 10, type: "Create", field_name: "priority", value: "urgent" }],
    });
  // Later audit that used to flip the actor: the first status Change, authored by whoever picks the ticket up.
  const laterStatusAudit = (authorId: number, id = 2): AuditRecord =>
    audit({
      id,
      created_at: "2026-09-28T11:14:47Z",
      author_id: authorId,
      via: { channel: "web" },
      events: [statusChange("solved", "open")],
    });

  const creator = (t: ZendeskTicket, audits: AuditRecord[]) =>
    deriveNormalizedEventsForTicket(t, audits, "raw_t", roles).find((e) => e.type === "case_created")!.actor;

  it("agent-created ticket stays agent-created when a customer-authored status change arrives later", () => {
    const t = base();
    expect(creator(t, [creationAudit(AGENT_ID)])).toBe("agent");
    expect(creator(t, [creationAudit(AGENT_ID), laterStatusAudit(CUSTOMER)])).toBe("agent");
  });

  it("customer-created ticket stays customer-created when an agent solves it before the first sync", () => {
    const t = base({ submitter_id: CUSTOMER });
    expect(creator(t, [creationAudit(CUSTOMER)])).toBe("customer");
    // Previously the solving agent (first status change) became the "creator".
    expect(creator(t, [creationAudit(CUSTOMER), laterStatusAudit(AGENT_ID)])).toBe("customer");
    expect(creator(t, [laterStatusAudit(AGENT_ID)])).toBe("customer");
  });

  it("submitter_id wins over an admin-authored creation audit (Zendesk's own view of a customer-submitted ticket)", () => {
    const t = base({ id: 1, submitter_id: CUSTOMER, via: { channel: "email" } });
    expect(creator(t, [creationAudit(AGENT_ID), laterStatusAudit(AGENT_ID)])).toBe("customer");
  });

  it("without submitter_id, the creation audit's author decides, not a later status change", () => {
    const t = base({ submitter_id: undefined });
    expect(creator(t, [creationAudit(AGENT_ID), laterStatusAudit(CUSTOMER)])).toBe("agent");
    expect(creator(t, [creationAudit(CUSTOMER), laterStatusAudit(AGENT_ID)])).toBe("customer");
  });

  it("without submitter_id or a creation audit, falls back to the requester (a customer), never to a later audit's author", () => {
    const t = base({ submitter_id: undefined });
    expect(creator(t, [])).toBe("customer");
    expect(creator(t, [laterStatusAudit(AGENT_ID)])).toBe("customer");
  });

  it("is the same for every prefix of the audit history (replay is stable as audits arrive)", () => {
    const t = base();
    const history = [creationAudit(AGENT_ID), laterStatusAudit(AGENT_ID, 2), laterStatusAudit(CUSTOMER, 3)];
    const actors = [1, 2, 3].map((n) => creator(t, history.slice(0, n)));
    expect(new Set(actors)).toEqual(new Set(["agent"]));
    expect(creator(t, [])).toBe("agent"); // submitter_id alone already decides
  });

  it("re-normalization is deterministic: identical input twice, and audit order does not matter", () => {
    const t = base();
    const audits = [creationAudit(AGENT_ID), laterStatusAudit(AGENT_ID)];
    const first = deriveNormalizedEventsForTicket(t, audits, "raw_t", roles);
    expect(deriveNormalizedEventsForTicket(t, audits, "raw_t", roles)).toEqual(first);
    expect(deriveNormalizedEventsForTicket(t, [...audits].reverse(), "raw_t", roles)).toEqual(first);
  });

  describe("first-response start (D5b) follows the fixed creation actor", () => {
    const asEvents = (derived: DerivedNormalizedEvent[]): NormalizedEvent[] =>
      derived.map((event, i) => ({ ...event, id: `evt-${i}`, caseId: "case-54", system: "zendesk", sourceRole: "ticket_source" as const }));
    const firstResponseStart = (t: ZendeskTicket, audits: AuditRecord[]) =>
      resolveFirstResponseStartedAt(asEvents(deriveNormalizedEventsForTicket(t, audits, "raw_t", roles)), t.created_at);

    it("agent-submitted ticket with no customer reply never starts a first-response clock, before or after the solve audit", () => {
      const t = base();
      expect(firstResponseStart(t, [creationAudit(AGENT_ID)])).toBeNull();
      expect(firstResponseStart(t, [creationAudit(AGENT_ID), laterStatusAudit(AGENT_ID)])).toBeNull();
    });

    it("customer-submitted ticket starts at creation whether or not an agent already touched it", () => {
      const t = base({ id: 1, submitter_id: CUSTOMER });
      expect(firstResponseStart(t, [creationAudit(CUSTOMER)])).toBe(CREATED);
      expect(firstResponseStart(t, [creationAudit(CUSTOMER), laterStatusAudit(AGENT_ID)])).toBe(CREATED);
    });
  });
});
