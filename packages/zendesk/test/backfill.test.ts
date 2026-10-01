import { afterEach, describe, expect, it, vi } from "vitest";
import { runZendeskBackfill } from "../src/backfill";
import type { ZendeskCredentials, ZendeskCursor, ZendeskJiraLink, ZendeskTicket } from "../src/types";

const config = { clientId: "client-123", clientSecret: "secret-xyz", redirectUri: "https://app.example.com/cb" };

const credentials: ZendeskCredentials = {
  subdomain: "acme",
  accessToken: "token-abc",
  tokenType: "bearer",
  scope: "read",
};

function createFakePrisma(cursor: ZendeskCursor | null = null) {
  let row: { credentials: ZendeskCredentials; cursor: ZendeskCursor | null } = {
    credentials: structuredClone(credentials),
    cursor,
  };
  const rawEvents: unknown[] = [];
  return {
    integration: {
      findUniqueOrThrow: vi.fn(async () => ({ ...structuredClone(row), organizationId: "org-1" })),
      update: vi.fn(async ({ data }: { data: { cursor: ZendeskCursor } }) => {
        row = { ...row, cursor: data.cursor };
        return structuredClone(row);
      }),
    },
    rawEvent: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        rawEvents.push(...data);
        return { count: data.length };
      }),
    },
    _rawEvents: rawEvents,
  } as const;
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runZendeskBackfill", () => {
  it("skips a ticket whose audits return 404 instead of aborting the whole run", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/api/v2/incremental/tickets.json")) {
        return jsonResponse(200, { tickets: [ticket(1), ticket(2)], end_time: 1000, next_page: null, count: 2 });
      }
      if (url.includes("/api/v2/tickets/1/audits.json")) {
        return jsonResponse(404, { error: "RecordNotFound" });
      }
      if (url.includes("/api/v2/tickets/2/audits.json")) {
        return jsonResponse(200, {
          audits: [{ id: 900, ticket_id: 2, created_at: "2026-01-01T00:00:00Z", author_id: 1, events: [] }],
          next_page: null,
        });
      }
      if (url.includes("/api/v2/incremental/organizations.json")) {
        return jsonResponse(200, { organizations: [], end_time: 1000, next_page: null, count: 0 });
      }
      if (url.includes("/api/v2/slas/policies.json")) {
        return jsonResponse(200, { sla_policies: [], next_page: null });
      }
      if (url.includes("/api/v2/business_hours/schedules.json")) {
        return jsonResponse(200, { schedules: [] });
      }
      if (url.includes("/api/v2/jira/links")) {
        return jsonResponse(200, { links: [], meta: { has_more: false } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const prisma = createFakePrisma();
    const result = await runZendeskBackfill(prisma as never, "integration-1", config);

    expect(result.ticketsFetched).toBe(2);
    expect(result.ticketAuditsFetched).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("\"event\":\"backfill_ticket_audits_not_found\""),
    );
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("\"ticketId\":1"));
  });

  it("records a deletion (not a ticket) for a ticket the incremental export reports as deleted, without fetching its audits", async () => {
    const deletedTicket: ZendeskTicket = { ...ticket(3), status: "deleted" };
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/api/v2/incremental/tickets.json")) {
        return jsonResponse(200, { tickets: [deletedTicket, ticket(4)], end_time: 1000, next_page: null, count: 2 });
      }
      if (url.includes("/api/v2/tickets/4/audits.json")) {
        return jsonResponse(200, {
          audits: [{ id: 900, ticket_id: 4, created_at: "2026-01-01T00:00:00Z", author_id: 1, events: [] }],
          next_page: null,
        });
      }
      if (url.includes("/api/v2/incremental/organizations.json")) {
        return jsonResponse(200, { organizations: [], end_time: 1000, next_page: null, count: 0 });
      }
      if (url.includes("/api/v2/slas/policies.json")) {
        return jsonResponse(200, { sla_policies: [], next_page: null });
      }
      if (url.includes("/api/v2/business_hours/schedules.json")) {
        return jsonResponse(200, { schedules: [] });
      }
      if (url.includes("/api/v2/jira/links")) {
        return jsonResponse(200, { links: [], meta: { has_more: false } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const prisma = createFakePrisma();
    const result = await runZendeskBackfill(prisma as never, "integration-1", config);

    expect(result.ticketsFetched).toBe(1);
    const providerEventIds = prisma._rawEvents.map((e) => (e as { providerEventId: string }).providerEventId);
    // Normalization turns the record into the Case soft-delete; ingestion writes no Case.
    expect(providerEventIds.some((id) => id.startsWith("ticket_deleted:3:"))).toBe(true);
    expect(providerEventIds.some((id) => id.startsWith("ticket:3:"))).toBe(false);
  });
});

// ticket_id is a string in the live API ("13", not 13) — see ZendeskJiraLink's doc comment.
function jiraLink(id: number, ticketId: string, issueKey: string): ZendeskJiraLink {
  return { id, ticket_id: ticketId, issue_key: issueKey };
}

/** Every non-jira-links endpoint a full `runZendeskBackfill` run touches, all returning empty. */
function emptyBaseHandlers(url: string): Response | null {
  if (url.includes("/api/v2/incremental/tickets.json")) {
    return jsonResponse(200, { tickets: [], end_time: 1000, next_page: null, count: 0 });
  }
  if (url.includes("/api/v2/incremental/organizations.json")) {
    return jsonResponse(200, { organizations: [], end_time: 1000, next_page: null, count: 0 });
  }
  if (url.includes("/api/v2/slas/policies.json")) {
    return jsonResponse(200, { sla_policies: [], next_page: null });
  }
  if (url.includes("/api/v2/business_hours/schedules.json")) {
    return jsonResponse(200, { schedules: [] });
  }
  return null;
}

describe("runZendeskBackfill — official Jira links (GET /api/v2/jira/links)", () => {
  it("fetches the first page with no query params, matching the live endpoint", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      const base = emptyBaseHandlers(url);
      if (base) return base;
      if (url === "https://acme.zendesk.com/api/v2/jira/links") {
        return jsonResponse(200, { links: [jiraLink(1, "13", "KAN-42")], total: 1, meta: { has_more: false } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const prisma = createFakePrisma();
    const result = await runZendeskBackfill(prisma as never, "integration-1", config);

    expect(result.jiraLinksFetched).toBe(1);
    const jiraLinkEvents = prisma._rawEvents.filter((e) =>
      (e as { providerEventId: string }).providerEventId.startsWith("jira_link:"),
    ) as { providerEventId: string }[];
    expect(jiraLinkEvents).toHaveLength(1);
    expect(jiraLinkEvents[0]!.providerEventId).toMatch(/^jira_link:1:/);
  });

  it("writes a manifest RawEvent recording every link id seen this run, for unlink detection", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      const base = emptyBaseHandlers(url);
      if (base) return base;
      if (url === "https://acme.zendesk.com/api/v2/jira/links") {
        return jsonResponse(200, {
          links: [jiraLink(1, "13", "KAN-42"), jiraLink(2, "124", "KAN-39")],
          meta: { has_more: false },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const prisma = createFakePrisma();
    await runZendeskBackfill(prisma as never, "integration-1", config);

    const manifests = prisma._rawEvents.filter((e) =>
      (e as { providerEventId: string }).providerEventId.startsWith("jira_link_manifest:"),
    ) as { payload: { linkIds: number[] } }[];
    expect(manifests).toHaveLength(1);
    expect(manifests[0]!.payload.linkIds).toEqual([1, 2]);
  });

  it("follows meta.has_more / meta.after_cursor (the live cursor-pagination envelope) across pages", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      const base = emptyBaseHandlers(url);
      if (base) return base;
      if (url === "https://acme.zendesk.com/api/v2/jira/links") {
        return jsonResponse(200, {
          links: [jiraLink(1, "123", "KAN-38")],
          total: 2,
          meta: { has_more: true, after_cursor: "cursor-abc" },
        });
      }
      if (url === "https://acme.zendesk.com/api/v2/jira/links?page%5Bafter%5D=cursor-abc") {
        return jsonResponse(200, { links: [jiraLink(2, "124", "KAN-39")], total: 2, meta: { has_more: false } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const prisma = createFakePrisma();
    const result = await runZendeskBackfill(prisma as never, "integration-1", config);

    expect(result.jiraLinksFetched).toBe(2);
    const jiraLinkEvents = prisma._rawEvents.filter((e) =>
      (e as { providerEventId: string }).providerEventId.startsWith("jira_link:"),
    ) as { providerEventId: string }[];
    expect(jiraLinkEvents).toHaveLength(2);
    expect(jiraLinkEvents.some((e) => e.providerEventId.startsWith("jira_link:1:"))).toBe(true);
    expect(jiraLinkEvents.some((e) => e.providerEventId.startsWith("jira_link:2:"))).toBe(true);
  });

  it("stops after one page when has_more is true but no after_cursor is given, rather than looping forever", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      const base = emptyBaseHandlers(url);
      if (base) return base;
      if (url === "https://acme.zendesk.com/api/v2/jira/links") {
        return jsonResponse(200, { links: [jiraLink(1, "13", "KAN-42")], meta: { has_more: true } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const prisma = createFakePrisma();
    const result = await runZendeskBackfill(prisma as never, "integration-1", config);

    expect(result.jiraLinksFetched).toBe(1);
    expect(fetchMock.mock.calls.filter((c) => c[0].toString().includes("/api/v2/jira/links"))).toHaveLength(1);
  });

  it("propagates an API failure instead of treating it as zero links", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = input.toString();
        const base = emptyBaseHandlers(url);
        if (base) return base;
        if (url === "https://acme.zendesk.com/api/v2/jira/links") {
          return jsonResponse(500, { error: "boom" });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const prisma = createFakePrisma();
      const pending = runZendeskBackfill(prisma as never, "integration-1", config).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const error = await pending;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Zendesk API error 500/);
    } finally {
      vi.useRealTimers();
    }
  });
});
