import type { ConversationEventRef, ConversationInput } from "@sla/ingestion";
import { describe, expect, it } from "vitest";
import { intercomConversationContext, renderIntercomConversation } from "../src/conversation";
import type { IntercomConversation, IntercomConversationPart } from "../src/types";

const caseCreated: ConversationEventRef = {
  id: "ev-created",
  type: "case_created",
  actor: "customer",
  occurredAt: "2026-10-05T09:00:00.000Z",
  sourceRawEventId: "raw-conversation",
};

const agentReply: ConversationEventRef = {
  id: "ev-agent",
  type: "agent_replied",
  actor: "agent",
  occurredAt: "2026-10-05T09:12:00.000Z",
  sourceRawEventId: "raw-part-1",
};

const agentPart: IntercomConversationPart = {
  id: "p1",
  part_type: "comment",
  created_at: 1,
  body: "<p>On it.</p>",
  author: { type: "admin", id: "a1", name: "Sam Agent" },
};

const conversation = (source: IntercomConversation["source"]): IntercomConversation => ({
  id: "7001",
  created_at: 1,
  updated_at: 1,
  state: "open",
  source,
});

function input(overrides: Partial<ConversationInput>): ConversationInput {
  return {
    case: { externalId: "7001", requesterName: "Pat Rivera" },
    events: [caseCreated, agentReply],
    payloads: new Map([["raw-part-1", agentPart]]),
    context: [],
    ...overrides,
  };
}

describe("intercomConversationContext", () => {
  it("names the conversation snapshots, and not the part raw events", () => {
    expect(intercomConversationContext("7001")).toEqual(["conversation:7001:"]);
    expect("conversation_part:7001:p1".startsWith("conversation:7001:")).toBe(false);
  });
});

describe("renderIntercomConversation", () => {
  it("prepends the opening message from the conversation's source", () => {
    const messages = renderIntercomConversation(
      input({
        context: [conversation({ type: "conversation", body: "<p>Pay now does nothing.</p>", author: { type: "user", id: "u1", name: "Pat Rivera" } })],
      }),
    );
    expect(messages.map((m) => m.body)).toEqual(["Pay now does nothing.", "On it."]);
    expect(messages[0]).toMatchObject({
      id: "ev-created:opening",
      occurredAt: caseCreated.occurredAt,
      actor: "customer",
      type: "customer_replied",
      authorName: "Pat Rivera",
    });
    // Like every other Intercom message, it carries no requester flag (Intercom replies are not matched to the requester).
    expect(messages[0]!.isRequester).toBeUndefined();
  });

  it("falls back to the case's requester name when the source author has none", () => {
    const [opening] = renderIntercomConversation(
      input({ context: [conversation({ type: "conversation", body: "<p>Hi</p>", author: { type: "user", id: "u1" } })] }),
    );
    expect(opening!.authorName).toBe("Pat Rivera");
  });

  it("shows a system-created conversation's opening as a neutral case_created message", () => {
    const [opening] = renderIntercomConversation(
      input({
        events: [{ ...caseCreated, actor: "system" }, agentReply],
        context: [conversation({ type: "conversation", body: "<p>Auto</p>" })],
      }),
    );
    expect(opening).toMatchObject({ type: "case_created", actor: "system", authorName: null });
  });

  it("adds nothing when there is no source body, no snapshot or no case_created event", () => {
    const replies = ["On it."];
    for (const overrides of [
      { context: [conversation({ type: "conversation", body: "  " })] },
      { context: [conversation({ type: "conversation", body: null })] },
      { context: [undefined] },
      { context: [] },
      { events: [agentReply], context: [conversation({ type: "conversation", body: "<p>Hi</p>" })] },
    ]) {
      expect(renderIntercomConversation(input(overrides)).map((m) => m.body)).toEqual(replies);
    }
  });

  it("never turns the opening message into a reply event input (display only)", () => {
    const messages = renderIntercomConversation(
      input({ context: [conversation({ type: "conversation", body: "<p>Hi</p>" })] }),
    );
    expect(messages.filter((m) => m.id === "ev-agent")).toHaveLength(1);
    expect(messages.some((m) => m.id === "ev-created")).toBe(false);
  });
});
