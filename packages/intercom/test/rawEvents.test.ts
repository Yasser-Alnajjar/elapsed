import { describe, expect, it } from "vitest";
import {
  mapAdminToRawEvent,
  mapCompanyToRawEvent,
  mapContactToRawEvent,
  mapConversationPartToRawEvent,
  mapConversationToRawEvent,
  mapTicketStatePartToRawEvent,
} from "../src/rawEvents";
import type {
  IntercomAdmin,
  IntercomCompany,
  IntercomContact,
  IntercomConversation,
  IntercomConversationPart,
} from "../src/types";

describe("mapConversationToRawEvent", () => {
  it("folds the content hash into the provider event id", () => {
    const conversation: IntercomConversation = { id: "42", created_at: 1, updated_at: 1, state: "open" };
    const event = mapConversationToRawEvent(conversation);
    expect(event.providerEventId).toBe(`conversation:42:${event.sourceHash}`);
    expect(event.payload).toBe(conversation);
  });

  it("produces a different provider event id when the conversation changes", () => {
    const a = mapConversationToRawEvent({ id: "42", created_at: 1, updated_at: 1, state: "open" });
    const b = mapConversationToRawEvent({ id: "42", created_at: 1, updated_at: 1, state: "closed" });
    expect(a.providerEventId).not.toBe(b.providerEventId);
  });
});

describe("mapConversationPartToRawEvent", () => {
  it("uses the bare part id with no hash suffix — parts are an immutable log", () => {
    const part: IntercomConversationPart = { id: "part-1", part_type: "close", created_at: 1 };
    const event = mapConversationPartToRawEvent("42", part);
    expect(event.providerEventId).toBe("conversation_part:42:part-1");
  });
});

describe("mapCompanyToRawEvent", () => {
  it("folds the content hash into the provider event id", () => {
    const company: IntercomCompany = { id: "co-1", name: "Acme", updated_at: 1 };
    const event = mapCompanyToRawEvent(company);
    expect(event.providerEventId).toBe(`company:co-1:${event.sourceHash}`);
  });
});

describe("mapContactToRawEvent", () => {
  it("folds the content hash into the provider event id", () => {
    const contact: IntercomContact = { id: "contact-1" };
    const event = mapContactToRawEvent(contact);
    expect(event.providerEventId).toBe(`contact:contact-1:${event.sourceHash}`);
  });
});

describe("mapAdminToRawEvent", () => {
  it("keeps only id and name, keyed by a hash that changes only when the name does", () => {
    const admin: IntercomAdmin = { id: "admin-1", name: "Ada Agent", email: "ada@example.com" };
    const result = mapAdminToRawEvent(admin);
    expect(result.payload).toEqual({ id: "admin-1", name: "Ada Agent" });
    expect(result.providerEventId).toBe(`admin:admin-1:${result.sourceHash}`);
    expect(mapAdminToRawEvent({ ...admin, email: "renamed@example.com" }).providerEventId).toBe(
      result.providerEventId,
    );
    expect(mapAdminToRawEvent({ ...admin, name: "Renamed" }).providerEventId).not.toBe(result.providerEventId);
  });
});

describe("mapTicketStatePartToRawEvent", () => {
  it("keys by conversation and part id with no hash suffix, and keeps only the state fields", () => {
    const event = mapTicketStatePartToRawEvent("42", {
      id: "part-9",
      part_type: "ticket_state_updated_by_admin",
      created_at: 5,
      previous_ticket_state: "in_progress",
      ticket_state: "waiting_on_customer",
      author: { type: "admin", id: "a1", name: "Ada", email: "ada@example.com" } as { type: string; id: string },
      body: "<p>ignored</p>",
    });
    expect(event.providerEventId).toBe("ticket_part:42:part-9");
    expect(event.payload).toEqual({
      id: "part-9",
      part_type: "ticket_state_updated_by_admin",
      created_at: 5,
      previous_ticket_state: "in_progress",
      ticket_state: "waiting_on_customer",
      author: { type: "admin", id: "a1" },
    });
  });
});
