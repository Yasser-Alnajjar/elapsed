/**
 * Case detail conversation view: the Case detail page must show every
 * public customer/agent message in chronological order, distinguishing
 * Customer from Agent off the already-resolved `NormalizedEvent.actor` —
 * never off a name or email — and must never surface a message that has no
 * normalized record (private/internal notes are never derived into a
 * NormalizedEvent in the first place; see @sla/zendesk's
 * `isPublicCommentEvent`). This is presentation/data-access only: it must
 * never change which commitments exist or how they're evaluated.
 */
import type { PrismaClient } from "@sla/db";
import { describe, expect, it } from "vitest";
import { getCaseDetailData } from "@/lib/case-detail-data";

const OPENED = new Date("2026-09-17T09:00:00.000Z");
const AS_OF = new Date("2026-09-17T15:00:00.000Z");

const TICKET_RAW_ID = "raw-ticket-1";
const REQUESTER_ID = 501;
const OTHER_END_USER_ID = 777; // a CC'd contact, not the requester
const AGENT_ID = 900;

function ticketRawEvent(
  overrides: Partial<{ requester_id: number | null; description: string | null }> = {},
) {
  return {
    id: TICKET_RAW_ID,
    payload: {
      id: 1,
      requester_id: REQUESTER_ID,
      ...overrides,
    },
  };
}

/** A small deterministic hash so distinct fixture rawEventIds default to distinct audit ids, even when neither carries digits (e.g. "raw-a" vs "raw-b"). */
function defaultAuditId(rawEventId: string): number {
  let hash = 0;
  for (let i = 0; i < rawEventId.length; i++) {
    hash = (hash * 31 + rawEventId.charCodeAt(i)) | 0;
  }
  return hash;
}

/** One Zendesk audit RawEvent row carrying a single Comment event. */
function auditRawEvent(
  rawEventId: string,
  overrides: {
    authorId: number;
    body: string;
    public?: boolean;
    createdAt?: string;
    /** The underlying Zendesk audit's own id — defaults to digits parsed out of `rawEventId`; override to simulate two RawEvent rows resolving to the same audit (3.7/C-5 dedup). */
    auditId?: number;
    /** The comment event's own id within the audit — defaults to 1. */
    commentId?: number;
  },
) {
  return {
    id: rawEventId,
    payload: {
      id: overrides.auditId ?? defaultAuditId(rawEventId),
      ticket_id: 1,
      created_at: overrides.createdAt ?? "2026-09-17T09:00:00Z",
      author_id: overrides.authorId,
      events: [
        {
          id: overrides.commentId ?? 1,
          type: "Comment",
          public: overrides.public ?? true,
          body: overrides.body,
          author_id: overrides.authorId,
        },
      ],
    },
  };
}

function normalizedEvent(overrides: {
  id: string;
  type: string;
  occurredAt: Date;
  actor?: string;
  sourceRawEventId: string;
  sourceSequence?: number;
}) {
  return {
    id: overrides.id,
    caseId: "case-1",
    type: overrides.type,
    occurredAt: overrides.occurredAt,
    actor: overrides.actor ?? "agent",
    system: "zendesk",
    fromState: null,
    toState: null,
    sourceRawEventId: overrides.sourceRawEventId,
    sourceSequence: overrides.sourceSequence ?? 0,
  };
}

function fakePrisma(options: {
  events: ReturnType<typeof normalizedEvent>[];
  rawEvents: ReturnType<typeof auditRawEvent>[];
  ticket?: ReturnType<typeof ticketRawEvent> | null;
  requesterName?: string | null;
  /** The ticket source the case came from; Zendesk unless a test says otherwise. */
  provider?: "zendesk" | "intercom";
}): PrismaClient {
  const provider = options.provider ?? "zendesk";
  return {
    case: {
      findFirst: async () => ({
        id: "case-1",
        organizationId: "org-1",
        externalId: "1",
        system: provider,
        subject: "Login trouble",
        priority: "high",
        tier: null,
        channel: "web",
        openedAt: OPENED,
        closedAt: null,
        customer: { name: "Acme Corp" },
        requesterName: options.requesterName ?? "Jane Requester",
        caseLinks: [],
        commitments: [],
      }),
    },
    normalizedEvent: { findMany: async () => options.events },
    rawEvent: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        options.rawEvents.filter((row) => where.id.in.includes(row.id)),
      findFirst: async () => (options.ticket === null ? null : options.ticket ?? ticketRawEvent()),
    },
    workerSettings: { findUnique: async () => null },
    integration: { findMany: async () => [{ id: `int-${provider}-1`, provider, credentials: null }] },
    organization: { findUnique: async () => ({ engineeringLegTargetMinutes: null }) },
    sLAPolicyVersion: { findMany: async () => [] },
    businessCalendarVersion: { findMany: async () => [] },
    commitmentPolicyChange: { findMany: async () => [] },
    notification: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

describe("getCaseDetailData: conversation", () => {
  it("shows a customer public comment", async () => {
    const events = [
      normalizedEvent({
        id: "ev-1",
        type: "customer_replied",
        occurredAt: new Date("2026-09-17T09:10:00.000Z"),
        actor: "customer",
        sourceRawEventId: "raw-2",
      }),
    ];
    const rawEvents = [auditRawEvent("raw-2", { authorId: REQUESTER_ID, body: "Hello, I need help" })];
    const data = await getCaseDetailData(fakePrisma({ events, rawEvents }), "org-1", "case-1", AS_OF);
    expect(data!.conversation).toEqual([
      {
        id: "ev-1",
        occurredAt: "2026-09-17T09:10:00.000Z",
        actor: "customer",
        type: "customer_replied",
        authorName: "Jane Requester",
        isRequester: true,
        body: "Hello, I need help",
      },
    ]);
  });

  it("shows an agent public reply", async () => {
    const events = [
      normalizedEvent({
        id: "ev-1",
        type: "agent_replied",
        occurredAt: new Date("2026-09-17T09:15:00.000Z"),
        actor: "agent",
        sourceRawEventId: "raw-3",
      }),
    ];
    const rawEvents = [auditRawEvent("raw-3", { authorId: AGENT_ID, body: "Sure, I'm checking this" })];
    const data = await getCaseDetailData(fakePrisma({ events, rawEvents }), "org-1", "case-1", AS_OF);
    expect(data!.conversation).toEqual([
      {
        id: "ev-1",
        occurredAt: "2026-09-17T09:15:00.000Z",
        actor: "agent",
        type: "agent_replied",
        // Zendesk never persists a comment author's name, only their role
        // (see mapUserToRawEvent) — an agent's name is never available.
        authorName: null,
        body: "Sure, I'm checking this",
      },
    ]);
  });

  it("shows every message in the full exchange, in chronological order, not just SLA-relevant ones", async () => {
    const exchange: { type: string; actor: string; body: string; time: string }[] = [
      { type: "customer_replied", actor: "customer", body: "Hello, I need help", time: "2026-09-17T09:10:00.000Z" },
      { type: "agent_replied", actor: "agent", body: "Sure, I'm checking this", time: "2026-09-17T09:15:00.000Z" },
      { type: "customer_replied", actor: "customer", body: "Any update?", time: "2026-09-17T10:00:00.000Z" },
      { type: "agent_replied", actor: "agent", body: "Yes, here's the update", time: "2026-09-17T10:05:00.000Z" },
      { type: "customer_replied", actor: "customer", body: "Thanks", time: "2026-09-17T10:06:00.000Z" },
    ];
    const events = exchange.map((m, i) =>
      normalizedEvent({
        id: `ev-${i}`,
        type: m.type,
        actor: m.actor,
        occurredAt: new Date(m.time),
        sourceRawEventId: `raw-${i}`,
        sourceSequence: i,
      }),
    );
    const rawEvents = exchange.map((m, i) =>
      auditRawEvent(`raw-${i}`, { authorId: m.actor === "customer" ? REQUESTER_ID : AGENT_ID, body: m.body, createdAt: m.time }),
    );

    const data = await getCaseDetailData(fakePrisma({ events, rawEvents }), "org-1", "case-1", AS_OF);
    expect(data!.conversation.map((m) => m.body)).toEqual(exchange.map((m) => m.body));
    expect(data!.conversation.map((m) => m.actor)).toEqual(exchange.map((m) => m.actor));
  });

  it("distinguishes Customer from Agent off the resolved actor, not off the author's name", async () => {
    // A CC'd end-user (not the ticket's requester) replies — actor is still
    // "customer" (already resolved upstream), but the display name is left
    // null rather than guessed from the requester's name.
    const events = [
      normalizedEvent({
        id: "ev-1",
        type: "customer_replied",
        actor: "customer",
        occurredAt: new Date("2026-09-17T09:10:00.000Z"),
        sourceRawEventId: "raw-2",
      }),
    ];
    const rawEvents = [auditRawEvent("raw-2", { authorId: OTHER_END_USER_ID, body: "Also following up" })];
    const data = await getCaseDetailData(fakePrisma({ events, rawEvents }), "org-1", "case-1", AS_OF);
    expect(data!.conversation[0]!.actor).toBe("customer");
    expect(data!.conversation[0]!.authorName).toBeNull();
  });

  it("never surfaces a private/internal note — it has no normalized record to read one from", async () => {
    // No NormalizedEvent was ever derived for the private note (matching
    // the real normalizer's behavior), so nothing references raw-private —
    // even if its RawEvent happens to be present, it's never looked up.
    const events = [
      normalizedEvent({
        id: "ev-1",
        type: "agent_replied",
        actor: "agent",
        occurredAt: new Date("2026-09-17T09:15:00.000Z"),
        sourceRawEventId: "raw-3",
      }),
    ];
    const rawEvents = [
      auditRawEvent("raw-3", { authorId: AGENT_ID, body: "Sure, I'm checking this" }),
      auditRawEvent("raw-private", { authorId: AGENT_ID, body: "internal-only escalation note", public: false }),
    ];
    const data = await getCaseDetailData(fakePrisma({ events, rawEvents }), "org-1", "case-1", AS_OF);
    expect(data!.conversation).toHaveLength(1);
    expect(data!.conversation.some((m) => m.body.includes("internal-only"))).toBe(false);
  });

  it("keeps two same-instant messages in a deterministic order (by sourceSequence), not DB fetch order", async () => {
    const sameInstant = new Date("2026-09-17T10:00:00.000Z");
    const customerMsg = normalizedEvent({
      id: "ev-customer",
      type: "customer_replied",
      actor: "customer",
      occurredAt: sameInstant,
      sourceRawEventId: "raw-a",
      sourceSequence: 5,
    });
    const agentMsg = normalizedEvent({
      id: "ev-agent",
      type: "agent_replied",
      actor: "agent",
      occurredAt: sameInstant,
      sourceRawEventId: "raw-b",
      sourceSequence: 6,
    });
    const rawEvents = [
      auditRawEvent("raw-a", { authorId: REQUESTER_ID, body: "customer text", createdAt: sameInstant.toISOString() }),
      auditRawEvent("raw-b", { authorId: AGENT_ID, body: "agent text", createdAt: sameInstant.toISOString() }),
    ];

    // Fed out of chronological/sequence order, as an unordered DB fetch might return them.
    const dataA = await getCaseDetailData(fakePrisma({ events: [agentMsg, customerMsg], rawEvents }), "org-1", "case-1", AS_OF);
    const dataB = await getCaseDetailData(fakePrisma({ events: [customerMsg, agentMsg], rawEvents }), "org-1", "case-1", AS_OF);

    expect(dataA!.conversation.map((m) => m.id)).toEqual(["ev-customer", "ev-agent"]);
    expect(dataB!.conversation.map((m) => m.id)).toEqual(["ev-customer", "ev-agent"]);
  });

  it("dedupes two NormalizedEvents that resolve to the same underlying Zendesk comment (3.7/C-5 defense in depth)", async () => {
    // Two distinct RawEvent snapshots that both happen to carry the exact
    // same audit id + comment id — as a stray duplicate NormalizedEvent row
    // from a normalization bug might produce, absent this display-layer
    // guard (normalization itself is trusted to be unique in the happy path).
    const events = [
      normalizedEvent({
        id: "ev-dup-1",
        type: "customer_replied",
        actor: "customer",
        occurredAt: new Date("2026-09-17T09:10:00.000Z"),
        sourceRawEventId: "raw-dup-1",
      }),
      normalizedEvent({
        id: "ev-dup-2",
        type: "customer_replied",
        actor: "customer",
        occurredAt: new Date("2026-09-17T09:10:00.000Z"),
        sourceRawEventId: "raw-dup-2",
        sourceSequence: 1,
      }),
    ];
    const rawEvents = [
      auditRawEvent("raw-dup-1", { authorId: REQUESTER_ID, body: "Hello, I need help", auditId: 500 }),
      auditRawEvent("raw-dup-2", { authorId: REQUESTER_ID, body: "Hello, I need help", auditId: 500 }),
    ];
    const data = await getCaseDetailData(fakePrisma({ events, rawEvents }), "org-1", "case-1", AS_OF);
    expect(data!.conversation).toHaveLength(1);
    expect(data!.conversation[0]!.id).toBe("ev-dup-1");
  });

  it("returns an empty conversation, and still resolves the case, when there are no reply events", async () => {
    const data = await getCaseDetailData(fakePrisma({ events: [], rawEvents: [] }), "org-1", "case-1", AS_OF);
    expect(data!.conversation).toEqual([]);
    expect(data!.case.id).toBe("case-1");
  });
});

describe("getCaseDetailData: conversation — email-created ticket's initial description", () => {
  const CASE_CREATED_AT = new Date("2026-09-17T09:00:00.000Z");

  it("shows the ticket description as the first Customer message when the ticket has no replies yet", async () => {
    const events = [
      normalizedEvent({
        id: "ev-created",
        type: "case_created",
        actor: "customer",
        occurredAt: CASE_CREATED_AT,
        sourceRawEventId: TICKET_RAW_ID,
      }),
    ];
    const data = await getCaseDetailData(
      fakePrisma({
        events,
        rawEvents: [],
        ticket: ticketRawEvent({ description: "My login is broken, please help." }),
      }),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.conversation).toEqual([
      {
        id: "ev-created:description",
        occurredAt: CASE_CREATED_AT.toISOString(),
        actor: "customer",
        type: "customer_replied",
        authorName: "Jane Requester",
        isRequester: true,
        body: "My login is broken, please help.",
      },
    ]);
  });

  it("puts the initial description first, ahead of subsequent Agent/Customer replies", async () => {
    const events = [
      normalizedEvent({
        id: "ev-created",
        type: "case_created",
        actor: "customer",
        occurredAt: CASE_CREATED_AT,
        sourceRawEventId: TICKET_RAW_ID,
      }),
      normalizedEvent({
        id: "ev-1",
        type: "agent_replied",
        actor: "agent",
        occurredAt: new Date("2026-09-17T09:15:00.000Z"),
        sourceRawEventId: "raw-3",
      }),
      normalizedEvent({
        id: "ev-2",
        type: "customer_replied",
        actor: "customer",
        occurredAt: new Date("2026-09-17T09:30:00.000Z"),
        sourceRawEventId: "raw-4",
      }),
    ];
    const rawEvents = [
      auditRawEvent("raw-3", { authorId: AGENT_ID, body: "Sure, I'm checking this", createdAt: "2026-09-17T09:15:00Z" }),
      auditRawEvent("raw-4", { authorId: REQUESTER_ID, body: "Any update?", createdAt: "2026-09-17T09:30:00Z" }),
    ];
    const data = await getCaseDetailData(
      fakePrisma({
        events,
        rawEvents,
        ticket: ticketRawEvent({ description: "My login is broken, please help." }),
      }),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.conversation.map((m) => ({ actor: m.actor, body: m.body }))).toEqual([
      { actor: "customer", body: "My login is broken, please help." },
      { actor: "agent", body: "Sure, I'm checking this" },
      { actor: "customer", body: "Any update?" },
    ]);
    // The synthetic id is namespaced off the case_created event's own id, so
    // it can never collide with a real agent_replied/customer_replied id.
    expect(data!.conversation[0]!.id).toBe("ev-created:description");
  });

  it("does not duplicate the initial message, and never adds one when the ticket has no description", async () => {
    const events = [
      normalizedEvent({
        id: "ev-created",
        type: "case_created",
        actor: "customer",
        occurredAt: CASE_CREATED_AT,
        sourceRawEventId: TICKET_RAW_ID,
      }),
      normalizedEvent({
        id: "ev-1",
        type: "agent_replied",
        actor: "agent",
        occurredAt: new Date("2026-09-17T09:15:00.000Z"),
        sourceRawEventId: "raw-3",
      }),
    ];
    const rawEvents = [auditRawEvent("raw-3", { authorId: AGENT_ID, body: "Sure, I'm checking this" })];
    const data = await getCaseDetailData(
      fakePrisma({ events, rawEvents, ticket: ticketRawEvent({ description: null }) }),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.conversation).toHaveLength(1);
    expect(data!.conversation[0]!.body).toBe("Sure, I'm checking this");
  });

  it("shows the initial message on a system-opened ticket as a neutral system note, not a Customer/Agent bubble (3.7)", async () => {
    const events = [
      normalizedEvent({
        id: "ev-created",
        type: "case_created",
        actor: "system",
        occurredAt: CASE_CREATED_AT,
        sourceRawEventId: TICKET_RAW_ID,
      }),
    ];
    const data = await getCaseDetailData(
      fakePrisma({ events, rawEvents: [], ticket: ticketRawEvent({ description: "Auto-generated ticket body" }) }),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.conversation).toEqual([
      {
        id: "ev-created:description",
        occurredAt: CASE_CREATED_AT.toISOString(),
        actor: "system",
        type: "case_created",
        authorName: null,
        body: "Auto-generated ticket body",
      },
    ]);
  });

  it("does not add the initial description to the Activity Timeline, and leaves SLA-relevant data untouched", async () => {
    const events = [
      normalizedEvent({
        id: "ev-created",
        type: "case_created",
        actor: "customer",
        occurredAt: CASE_CREATED_AT,
        sourceRawEventId: TICKET_RAW_ID,
      }),
      normalizedEvent({
        id: "ev-1",
        type: "agent_replied",
        actor: "agent",
        occurredAt: new Date("2026-09-17T09:15:00.000Z"),
        sourceRawEventId: "raw-3",
      }),
    ];
    const rawEvents = [auditRawEvent("raw-3", { authorId: AGENT_ID, body: "Sure, I'm checking this" })];
    const data = await getCaseDetailData(
      fakePrisma({
        events,
        rawEvents,
        ticket: ticketRawEvent({ description: "My login is broken, please help." }),
      }),
      "org-1",
      "case-1",
      AS_OF,
    );
    // The Conversation gained a synthetic entry, but the timeline is still
    // built straight off the persisted NormalizedEvent rows — one per input
    // event, no extra entry for the description.
    expect(data!.timeline).toHaveLength(events.length);
    expect(data!.timeline.map((e) => e.id)).toEqual(events.map((e) => e.id));
    // No Commitment rows were configured in this fixture, so this is
    // trivially empty either way — the point is that conversation-building
    // has no path that could add or remove one.
    expect(data!.commitments).toEqual([]);
  });
});

describe("getCaseDetailData: Intercom conversation", () => {
  it("shows the conversation's opening message before the replies, like a Zendesk ticket's description", async () => {
    const events = [
      normalizedEvent({ id: "ev-created", type: "case_created", occurredAt: OPENED, actor: "customer", sourceRawEventId: "raw-conversation" }),
      normalizedEvent({
        id: "ev-1",
        type: "agent_replied",
        occurredAt: new Date("2026-09-17T09:15:00.000Z"),
        actor: "agent",
        sourceRawEventId: "raw-part-1",
      }),
    ];
    const rawEvents = [
      {
        id: "raw-part-1",
        payload: { id: "p1", part_type: "comment", created_at: 1, body: "<p>Looking now.</p>", author: { type: "admin", id: "a1", name: "Sam Agent" } },
      },
    ];
    const ticket = {
      id: "raw-conversation",
      payload: {
        id: "1",
        created_at: 1,
        updated_at: 1,
        state: "open",
        source: { type: "conversation", body: "<p>Cannot log in.</p>", author: { type: "user", id: "u1", name: "Jane Requester" } },
      },
    };
    const data = await getCaseDetailData(
      fakePrisma({ events, rawEvents: rawEvents as never, ticket: ticket as never, provider: "intercom" }),
      "org-1",
      "case-1",
      AS_OF,
    );
    expect(data!.conversation.map((m) => [m.authorName, m.body])).toEqual([
      ["Jane Requester", "Cannot log in."],
      ["Sam Agent", "Looking now."],
    ]);
  });
});
