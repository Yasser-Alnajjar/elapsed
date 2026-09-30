import { describe, expect, it } from "vitest";
import { parseZendeskTicketId, recognizeZendeskTicketUrl } from "../src/ticket-url";

describe("parseZendeskTicketId", () => {
  it("matches the agent view URL on the right subdomain", () => {
    expect(parseZendeskTicketId("https://acme.zendesk.com/agent/tickets/42", "acme")).toBe("42");
  });

  it("matches the bare /tickets/<id> URL that Zendesk's Linear integration stores on the issue", () => {
    expect(parseZendeskTicketId("https://acme.zendesk.com/tickets/42", "acme")).toBe("42");
  });

  it("returns null for a bare /tickets/<id> URL on another subdomain", () => {
    expect(parseZendeskTicketId("https://someoneelse.zendesk.com/tickets/42", "acme")).toBeNull();
  });

  it("matches the end-user request view URL", () => {
    expect(parseZendeskTicketId("https://acme.zendesk.com/requests/42", "acme")).toBe("42");
  });

  it("matches the raw API URL", () => {
    expect(parseZendeskTicketId("https://acme.zendesk.com/api/v2/tickets/42.json", "acme")).toBe("42");
  });

  it("is case-insensitive on the subdomain", () => {
    expect(parseZendeskTicketId("https://Acme.zendesk.com/agent/tickets/42", "acme")).toBe("42");
  });

  it("returns null for a different subdomain — never correlates cross-tenant", () => {
    expect(parseZendeskTicketId("https://someoneelse.zendesk.com/agent/tickets/42", "acme")).toBeNull();
  });

  it("returns null for a lookalike host", () => {
    expect(parseZendeskTicketId("https://acme.zendesk.com.evil.example/agent/tickets/42", "acme")).toBeNull();
  });

  it("returns null for a non-Zendesk URL", () => {
    expect(parseZendeskTicketId("https://github.com/acme/repo/issues/42", "acme")).toBeNull();
  });

  it("returns null for an unparseable URL", () => {
    expect(parseZendeskTicketId("not a url", "acme")).toBeNull();
  });

  it("returns null for a Zendesk URL that doesn't point at a ticket", () => {
    expect(parseZendeskTicketId("https://acme.zendesk.com/agent/dashboard", "acme")).toBeNull();
  });
});

describe("recognizeZendeskTicketUrl (N1.13)", () => {
  const url = "https://acme.zendesk.com/agent/tickets/42";

  it("recognizes a ticket on the integration's own subdomain", () => {
    expect(recognizeZendeskTicketUrl(url, { subdomain: "acme" })).toBe("42");
  });

  it("recognizes nothing on another subdomain", () => {
    expect(recognizeZendeskTicketUrl(url, { subdomain: "other" })).toBeNull();
  });

  it("recognizes nothing when the credentials carry no usable subdomain", () => {
    for (const credentials of [null, undefined, {}, { subdomain: "" }, { subdomain: 5 }, "acme"]) {
      expect(recognizeZendeskTicketUrl(url, credentials)).toBeNull();
    }
  });
});
