/**
 * N2.6/N2.7 — the web registry: what each provider's adapter says about
 * itself (role, capabilities), how it links to its own records, how a ticket
 * source renders a Conversation, and how a webhook delivery is authenticated.
 * Pure: no database.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ISSUE_LINK_PROVIDERS,
  PROVIDERS,
  TICKET_SOURCE_PROVIDERS,
  WEB_PROVIDERS,
  externalUrlFor,
  isIssueLinkSystem,
  providersWithCapability,
  providerRole,
} from "@/lib/providers";

describe("provider registry", () => {
  it("names every provider once, and each adapter knows its own provider", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(["custom", "github", "intercom", "jira", "linear", "zendesk"]);
    for (const [provider, adapter] of Object.entries(PROVIDERS)) expect(adapter.provider).toBe(provider);
    expect(Object.keys(WEB_PROVIDERS).sort()).toEqual(Object.keys(PROVIDERS).sort());
  });

  it("splits providers by role into the sources a Case comes from and the legs it links to", () => {
    expect([...TICKET_SOURCE_PROVIDERS].sort()).toEqual(["custom", "intercom", "zendesk"]);
    expect([...ISSUE_LINK_PROVIDERS].sort()).toEqual(["github", "jira", "linear"]);
    expect(providerRole("github")).toBe("code_host");
    expect(isIssueLinkSystem("jira")).toBe(true);
    expect(isIssueLinkSystem("zendesk")).toBe(false);
    expect(isIssueLinkSystem("nonsense")).toBe(false);
  });

  it("reads webhook, import and reply behaviour from capabilities", () => {
    expect([...providersWithCapability("webhooks")].sort()).toEqual(["jira", "zendesk"]);
    expect(providersWithCapability("policyImport")).toEqual(["zendesk"]);
    expect(providersWithCapability("calendarImport")).toEqual(["zendesk"]);
    expect([...providersWithCapability("replyEvents")].sort()).toEqual(["custom", "intercom", "zendesk"]);
    expect(providersWithCapability("officialLinks")).toEqual(["zendesk"]);
  });

  it("only ticket sources recognise a case URL", () => {
    for (const provider of Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]) {
      expect(typeof PROVIDERS[provider].recognizeCaseUrl === "function", provider).toBe(PROVIDERS[provider].role === "ticket_source");
    }
  });
});

describe("externalUrl", () => {
  it("builds each provider's link from its stored credentials or evidence", () => {
    expect(externalUrlFor("zendesk", { externalId: "7", credentials: { subdomain: "acme" } })).toBe("https://acme.zendesk.com/agent/tickets/7");
    expect(externalUrlFor("jira", { externalId: "ENG-1", credentials: { siteUrl: "https://acme.atlassian.net/" } })).toBe(
      "https://acme.atlassian.net/browse/ENG-1",
    );
    expect(externalUrlFor("github", { externalId: "acme/app#12", credentials: null })).toBe("https://github.com/acme/app/pull/12");
    expect(externalUrlFor("linear", { externalId: "ENG-2", credentials: null, evidence: { issueUrl: "https://linear.app/acme/issue/ENG-2" } })).toBe(
      "https://linear.app/acme/issue/ENG-2",
    );
    expect(externalUrlFor("intercom", { externalId: "c1", credentials: { workspaceId: "ws 1" } })).toBe(
      "https://app.intercom.com/a/apps/ws%201/conversations/c1",
    );
  });

  it("has no link when the data a link needs has not been recorded", () => {
    expect(externalUrlFor("zendesk", { externalId: "7", credentials: null })).toBeNull();
    expect(externalUrlFor("jira", { externalId: "ENG-1", credentials: {} })).toBeNull();
    expect(externalUrlFor("linear", { externalId: "ENG-2", credentials: null, evidence: {} })).toBeNull();
    // Intercom needs the workspace id the first sync records.
    expect(externalUrlFor("intercom", { externalId: "c1", credentials: {} })).toBeNull();
  });
});

describe("renderConversation", () => {
  const ref = (id: string, type: "agent_replied" | "customer_replied", actor: "agent" | "customer", rawId: string) => ({
    id,
    type,
    actor,
    occurredAt: "2026-09-17T09:10:00.000Z",
    sourceRawEventId: rawId,
  });

  it("renders an Intercom conversation from its parts: replies only, markup stripped", () => {
    const messages = WEB_PROVIDERS.intercom.renderConversation!({
      case: { externalId: "c1", requesterName: null },
      events: [
        { id: "e0", type: "case_created", actor: "customer", occurredAt: "2026-09-17T09:00:00.000Z", sourceRawEventId: "r0" },
        ref("e1", "agent_replied", "agent", "r1"),
        ref("e2", "customer_replied", "customer", "r2"),
        // The same part cited twice renders once.
        ref("e3", "agent_replied", "agent", "r1"),
      ],
      payloads: new Map<string, unknown>([
        ["r1", { id: "p1", part_type: "comment", created_at: 1, body: "<p>Hi<br/>there</p>", author: { type: "admin", id: "a", name: "Sam" } }],
        ["r2", { id: "p2", part_type: "comment", created_at: 2, body: "<p>Thanks &amp; bye</p>", author: { type: "user", id: "u" } }],
      ]),
      context: [],
    });

    expect(messages).toEqual([
      { id: "e1", occurredAt: "2026-09-17T09:10:00.000Z", actor: "agent", type: "agent_replied", authorName: "Sam", body: "Hi\nthere" },
      { id: "e2", occurredAt: "2026-09-17T09:10:00.000Z", actor: "customer", type: "customer_replied", authorName: null, body: "Thanks & bye" },
    ]);
  });

  it("renders a Zendesk conversation: the ticket's opening message, then each reply's audit comment", () => {
    expect(WEB_PROVIDERS.zendesk.conversationContext!("42")).toEqual(["ticket:42:"]);
    const messages = WEB_PROVIDERS.zendesk.renderConversation!({
      case: { externalId: "42", requesterName: "Jane" },
      events: [
        { id: "e0", type: "case_created", actor: "customer", occurredAt: "2026-09-17T09:00:00.000Z", sourceRawEventId: "t" },
        ref("e1", "customer_replied", "customer", "a1"),
      ],
      payloads: new Map<string, unknown>([
        ["a1", { id: 9, ticket_id: 42, created_at: "2026-09-17T09:10:00Z", author_id: 5, events: [{ id: 1, type: "Comment", public: true, body: "Still broken", author_id: 5 }] }],
      ]),
      context: [{ requester_id: 5, description: "It does not work" }],
    });

    expect(messages).toEqual([
      { id: "e0:description", occurredAt: "2026-09-17T09:00:00.000Z", actor: "customer", type: "customer_replied", authorName: "Jane", isRequester: true, body: "It does not work" },
      { id: "e1", occurredAt: "2026-09-17T09:10:00.000Z", actor: "customer", type: "customer_replied", authorName: "Jane", isRequester: true, body: "Still broken" },
    ]);
  });

  it("only ticket sources render a conversation", () => {
    for (const provider of ISSUE_LINK_PROVIDERS) expect(WEB_PROVIDERS[provider].renderConversation, provider).toBeUndefined();
  });
});

describe("verifyWebhook", () => {
  const SECRET = "s3cret";
  const body = JSON.stringify({ webhookEvent: "jira:issue_updated", issue: { key: "ENG-1" } });

  it("accepts a Zendesk delivery that carries the secret as a Bearer token, and nothing else", async () => {
    const verify = WEB_PROVIDERS.zendesk.verifyWebhook!;
    expect(await verify(new Request("https://x.test/h", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }), SECRET)).toBe(true);
    expect(await verify(new Request("https://x.test/h", { method: "POST", headers: { authorization: "Bearer nope" } }), SECRET)).toBe(false);
    expect(await verify(new Request("https://x.test/h", { method: "POST" }), SECRET)).toBe(false);
  });

  it("accepts a Jira delivery signed with the secret, and never falls back to ?secret= once a signature is present", async () => {
    const verify = WEB_PROVIDERS.jira.verifyWebhook!;
    const signature = `sha256=${createHmac("sha256", SECRET).update(body, "utf8").digest("hex")}`;
    const signed = (header: string, url = "https://x.test/h") =>
      new Request(url, { method: "POST", headers: { "x-hub-signature": header }, body });

    expect(await verify(signed(signature), SECRET)).toBe(true);
    expect(await verify(signed("sha256=" + "0".repeat(64)), SECRET)).toBe(false);
    expect(await verify(signed("sha256=" + "0".repeat(64), `https://x.test/h?secret=${SECRET}`), SECRET)).toBe(false);
  });

  it("accepts the legacy ?secret= form only when there is no signature header", async () => {
    const verify = WEB_PROVIDERS.jira.verifyWebhook!;
    expect(await verify(new Request(`https://x.test/h?secret=${SECRET}`, { method: "POST", body }), SECRET)).toBe(true);
    expect(await verify(new Request("https://x.test/h?secret=wrong", { method: "POST", body }), SECRET)).toBe(false);
    expect(await verify(new Request("https://x.test/h", { method: "POST", body }), SECRET)).toBe(false);
  });

  it("is offered only by providers with the webhooks capability", () => {
    for (const provider of Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]) {
      expect(typeof WEB_PROVIDERS[provider].verifyWebhook === "function", provider).toBe(PROVIDERS[provider].capabilities.webhooks);
    }
  });
});
