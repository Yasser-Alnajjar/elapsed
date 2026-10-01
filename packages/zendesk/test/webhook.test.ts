import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractZendeskWebhookTicketId,
  extractZendeskWebhookTimestamp,
  generateWebhookSecret,
  isZendeskWebhookTimestampFresh,
  runZendeskWebhookIngest,
  verifyZendeskWebhookSecret,
} from "../src/webhook";
import type { ZendeskCredentials, ZendeskCursor, ZendeskTicket } from "../src/types";

const config = { clientId: "client-123", clientSecret: "secret-xyz", redirectUri: "https://app.example.com/cb" };

const credentials: ZendeskCredentials = {
  subdomain: "acme",
  accessToken: "token-abc",
  tokenType: "bearer",
  scope: "read",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function ticket(id: number): ZendeskTicket {
  return {
    id,
    url: `https://acme.zendesk.com/api/v2/tickets/${id}.json`,
    external_id: null,
    subject: "Cannot log in to account",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: "open",
    priority: null,
    organization_id: null,
  };
}

function createFakePrisma(cursor: ZendeskCursor | null = null) {
  const row: { credentials: ZendeskCredentials; cursor: ZendeskCursor | null; organizationId: string } = {
    credentials: structuredClone(credentials),
    cursor,
    organizationId: "org-1",
  };
  const rawEvents: { integrationId: string; providerEventId: string }[] = [];
  return {
    integration: {
      findUniqueOrThrow: vi.fn(async () => structuredClone(row)),
      update: vi.fn(async () => {
        throw new Error("runZendeskWebhookIngest must never touch Integration.cursor");
      }),
    },
    rawEvent: {
      createMany: vi.fn(async ({ data }: { data: { integrationId: string; providerEventId: string }[] }) => {
        rawEvents.push(...data);
        return { count: data.length };
      }),
    },
    _rawEvents: rawEvents,
  } as const;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateWebhookSecret", () => {
  it("produces distinct, non-trivial secrets", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe("verifyZendeskWebhookSecret", () => {
  const secret = "bearer-token-abc123";

  it("accepts a matching bearer token", () => {
    expect(verifyZendeskWebhookSecret(secret, `Bearer ${secret}`)).toBe(true);
  });

  it("rejects a mismatched bearer token", () => {
    expect(verifyZendeskWebhookSecret(secret, "Bearer wrong-token")).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(verifyZendeskWebhookSecret(secret, null)).toBe(false);
  });

  it("rejects a header that isn't in Bearer form", () => {
    expect(verifyZendeskWebhookSecret(secret, secret)).toBe(false);
    expect(verifyZendeskWebhookSecret(secret, `Basic ${secret}`)).toBe(false);
  });

  it("rejects a token of a different length without throwing", () => {
    expect(verifyZendeskWebhookSecret(secret, `Bearer ${secret}extra`)).toBe(false);
  });
});

describe("extractZendeskWebhookTicketId", () => {
  it("reads the documented custom-trigger shape", () => {
    expect(extractZendeskWebhookTicketId({ ticket_id: "42" })).toBe(42);
  });

  it("reads a native ticket-events envelope's detail.id", () => {
    expect(extractZendeskWebhookTicketId({ detail: { id: 42 } })).toBe(42);
  });

  it("reads a nested ticket.id shape", () => {
    expect(extractZendeskWebhookTicketId({ ticket: { id: 42 } })).toBe(42);
  });

  it("returns null for a payload with no recognizable ticket id", () => {
    expect(extractZendeskWebhookTicketId({ foo: "bar" })).toBeNull();
    expect(extractZendeskWebhookTicketId(null)).toBeNull();
    expect(extractZendeskWebhookTicketId("not an object")).toBeNull();
  });
});

describe("extractZendeskWebhookTimestamp", () => {
  it("reads the documented custom-trigger timestamp field as an ISO-8601 string", () => {
    expect(extractZendeskWebhookTimestamp({ ticket_id: "42", timestamp: "2026-01-01T00:00:00Z" })).toBe(
      Date.parse("2026-01-01T00:00:00Z"),
    );
  });

  it("reads {{ticket.updated_at_with_timestamp}}'s minute-precision rendering", () => {
    // Format from Zendesk's placeholder reference for business rules.
    expect(extractZendeskWebhookTimestamp({ ticket_id: "42", timestamp: "2013-12-12T05:35Z" })).toBe(
      Date.parse("2013-12-12T05:35:00Z"),
    );
  });

  it("rejects {{ticket.updated_at}}'s date-only rendering instead of parsing it as 2001", () => {
    expect(extractZendeskWebhookTimestamp({ ticket_id: "42", timestamp: "May 18" })).toBeNull();
    expect(extractZendeskWebhookTimestamp({ ticket_id: "42", timestamp: "May 18, 2014" })).toBeNull();
    expect(extractZendeskWebhookTimestamp({ ticket_id: "42", timestamp: "February 10, 14:29" })).toBeNull();
  });

  it("reads a nested ticket.updated_at or detail.updated_at shape", () => {
    expect(extractZendeskWebhookTimestamp({ ticket: { updated_at: "2026-01-01T00:00:00Z" } })).toBe(
      Date.parse("2026-01-01T00:00:00Z"),
    );
    expect(extractZendeskWebhookTimestamp({ detail: { updated_at: "2026-01-01T00:00:00Z" } })).toBe(
      Date.parse("2026-01-01T00:00:00Z"),
    );
  });

  it("treats a numeric value below the epoch-ms threshold as seconds", () => {
    expect(extractZendeskWebhookTimestamp({ timestamp: 1_700_000_000 })).toBe(1_700_000_000_000);
  });

  it("treats a numeric value at or above the epoch-ms threshold as milliseconds", () => {
    expect(extractZendeskWebhookTimestamp({ timestamp: 1_700_000_000_000 })).toBe(1_700_000_000_000);
  });

  it("returns null for a payload with no recognizable or unparseable timestamp", () => {
    expect(extractZendeskWebhookTimestamp({ ticket_id: "42" })).toBeNull();
    expect(extractZendeskWebhookTimestamp({ timestamp: "not a date" })).toBeNull();
    expect(extractZendeskWebhookTimestamp(null)).toBeNull();
  });
});

describe("isZendeskWebhookTimestampFresh", () => {
  const now = Date.parse("2026-01-01T00:10:00Z");

  it("accepts a delivery rendered from {{ticket.updated_at_with_timestamp}}, truncated to the minute", () => {
    expect(isZendeskWebhookTimestampFresh({ timestamp: "2026-01-01T00:09Z" }, now + 59_000)).toBe(true);
  });

  it("rejects a date-only {{ticket.updated_at}} rendering even on the current day", () => {
    expect(isZendeskWebhookTimestampFresh({ timestamp: "January 1" }, now)).toBe(false);
  });

  it("accepts a timestamp within the freshness window", () => {
    expect(isZendeskWebhookTimestampFresh({ timestamp: "2026-01-01T00:08:00Z" }, now)).toBe(true);
  });

  it("rejects a timestamp older than the freshness window", () => {
    expect(isZendeskWebhookTimestampFresh({ timestamp: "2026-01-01T00:00:00Z" }, now)).toBe(false);
  });

  it("rejects a timestamp implausibly far in the future (clock skew beyond tolerance)", () => {
    expect(isZendeskWebhookTimestampFresh({ timestamp: "2026-01-01T01:00:00Z" }, now)).toBe(false);
  });

  it("rejects a missing timestamp, failing closed", () => {
    expect(isZendeskWebhookTimestampFresh({ ticket_id: "42" }, now)).toBe(false);
  });
});

describe("runZendeskWebhookIngest", () => {
  it("fetches the ticket and all of its audit pages, and writes RawEvents without touching the cursor", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/api/v2/tickets/42.json")) {
        return jsonResponse(200, { ticket: ticket(42) });
      }
      if (url === "https://acme.zendesk.com/api/v2/tickets/42/audits.json?include=users") {
        return jsonResponse(200, {
          audits: [{ id: 1, ticket_id: 42, created_at: "2026-01-01T00:00:00Z", author_id: 1, events: [] }],
          users: [{ id: 1, role: "agent", name: "Agent A", email: "a@example.com" }],
          next_page: "https://acme.zendesk.com/api/v2/tickets/42/audits.json?page=2",
        });
      }
      if (url === "https://acme.zendesk.com/api/v2/tickets/42/audits.json?page=2&include=users") {
        return jsonResponse(200, {
          audits: [{ id: 2, ticket_id: 42, created_at: "2026-01-01T00:05:00Z", author_id: 1, events: [] }],
          next_page: null,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const prisma = createFakePrisma();
    const result = await runZendeskWebhookIngest(prisma as never, "integration-1", config, 42);

    expect(result).toEqual({ ticketsFetched: 1, ticketAuditsFetched: 2 });
    expect(prisma._rawEvents).toHaveLength(4);
    expect(prisma._rawEvents.map((e) => e.providerEventId)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ticket:42:"),
        "ticket_audit:1",
        "ticket_audit:2",
        expect.stringContaining("user:1:"),
      ]),
    );
    expect(prisma.integration.update).not.toHaveBeenCalled();
  });

  it("records the deletion (and writes no Case) instead of ingesting when the ticket 404s", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/api/v2/tickets/42.json")) {
        return jsonResponse(404, { error: "RecordNotFound" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const prisma = createFakePrisma();
    const result = await runZendeskWebhookIngest(prisma as never, "integration-1", config, 42);

    expect(result).toEqual({ ticketsFetched: 0, ticketAuditsFetched: 0, ticketDeleted: true });
    // Normalization turns the record into the Case soft-delete; ingestion writes no Case.
    expect(prisma._rawEvents.map((e) => e.providerEventId)).toEqual([expect.stringContaining("ticket_deleted:42:")]);
  });
});
