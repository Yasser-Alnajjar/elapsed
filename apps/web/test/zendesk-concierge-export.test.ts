import { ZendeskApiError, type ZendeskAudit, type ZendeskTicket } from "@sla/zendesk";
import { describe, expect, it } from "vitest";
// The files are only useful if Concierge reads them, so they're parsed with its own reader.
import { parseCsv } from "../../concierge/src/csv";
import { parseZendeskExport } from "../../concierge/src/zendesk";
import {
  buildZendeskConciergeExport,
  collectZendeskExport,
  exportStartTime,
  statusChangeRows,
  type ZendeskExportClient,
} from "@/lib/zendesk-concierge-export";
import { readStoredZip } from "@/lib/zip";

function ticket(id: number, overrides: Partial<ZendeskTicket> = {}): ZendeskTicket {
  return {
    id,
    url: "",
    external_id: null,
    subject: `Ticket ${id}`,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-03T10:00:00Z",
    status: "open",
    priority: "high",
    organization_id: 900,
    requester_id: 42,
    via: { channel: "email" },
    ...overrides,
  };
}

function statusAudit(id: number, ticketId: number, createdAt: string, from: string, to: string): ZendeskAudit {
  return { id, ticket_id: ticketId, created_at: createdAt, author_id: 7, via: { channel: "web" }, events: [{ id, type: "Change", field_name: "status", previous_value: from, value: to }] };
}

/**
 * Tickets span two incremental pages (the first is a full 1000-row page);
 * ticket 3's audits span two pages; ticket 4 is deleted in the export;
 * ticket 5's audits are gone (404).
 */
function fakeClient() {
  const calls = { ticketPages: [] as string[], audits: [] as [number, string | undefined][], orgPages: [] as string[], jiraPages: [] as string[] };
  const filler = Array.from({ length: 996 }, () => ticket(1, { subject: "stale copy" }));
  const audits: Record<number, ZendeskAudit[][]> = {
    1: [[
      { id: 11, ticket_id: 1, created_at: "2026-09-01T10:00:00Z", author_id: 42, events: [{ id: 110, type: "Create", field_name: "status", value: "new" }, { id: 111, type: "Comment" }] },
      statusAudit(12, 1, "2026-09-01T12:00:00Z", "new", "open"),
      { id: 13, ticket_id: 1, created_at: "2026-09-01T13:00:00Z", author_id: 7, events: [{ id: 130, type: "Change", field_name: "priority", previous_value: "normal", value: "high" }] },
    ]],
    2: [[]],
    3: [
      [statusAudit(32, 3, "2026-09-02T09:00:00Z", "open", "pending")],
      [statusAudit(31, 3, "2026-09-02T08:00:00Z", "new", "open"), statusAudit(33, 3, "2026-09-02T11:00:00Z", "pending", "solved")],
    ],
  };
  const client: ZendeskExportClient = {
    fetchTicketsPage: async (startTime) => {
      calls.ticketPages.push(`start:${startTime}`);
      return {
        count: 1000,
        end_time: 1,
        next_page: "https://acme.zendesk.com/next",
        tickets: [ticket(4), ...filler, ticket(1, { subject: 'Refund "urgent", please\nsecond line' }), ticket(2, { organization_id: null }), ticket(5)],
      };
    },
    fetchTicketsNextPage: async (url) => {
      calls.ticketPages.push(url);
      return { count: 2, end_time: 2, next_page: "https://acme.zendesk.com/next-2", tickets: [ticket(3, { status: "solved" }), ticket(4, { status: "deleted" })] };
    },
    fetchOrganizationsPage: async (startTime) => {
      calls.orgPages.push(`start:${startTime}`);
      return { count: 1, end_time: 1, next_page: null, organizations: [{ id: 900, name: "Acme, Inc.", updated_at: "" }] };
    },
    fetchOrganizationsNextPage: async () => {
      throw new Error("unexpected");
    },
    fetchJiraLinksPage: async (afterCursor) => {
      calls.jiraPages.push(afterCursor ?? "first");
      return afterCursor
        ? { links: [{ id: 3, ticket_id: "3", issue_key: "ENG-9" }, { id: 4, ticket_id: "oops", issue_key: "ENG-1" }], meta: { has_more: false } }
        : { links: [{ id: 1, ticket_id: "1", issue_key: "ENG-1" }, { id: 2, ticket_id: "1", issue_key: "ENG-2" }], meta: { has_more: true, after_cursor: "c1" } };
    },
    fetchTicketAuditsPage: async (ticketId, nextPageUrl) => {
      calls.audits.push([ticketId, nextPageUrl]);
      if (ticketId === 5) throw new ZendeskApiError(404, "https://acme.zendesk.com/api/v2/tickets/5/audits.json");
      const pages = audits[ticketId]!;
      const index = nextPageUrl ? Number(nextPageUrl.split("=")[1]) : 0;
      return { audits: pages[index]!, next_page: index + 1 < pages.length ? `audits?page=${index + 1}` : null };
    },
  };
  return { client, calls };
}

const NOW = new Date("2026-09-17T00:00:00Z");

describe("collectZendeskExport", () => {
  it("follows ticket and audit pagination, drops deleted tickets and skips 404s", async () => {
    const { client, calls } = fakeClient();
    const collected = await collectZendeskExport(client, { sinceDays: 90, now: NOW });

    expect(calls.ticketPages).toEqual([`start:${exportStartTime(90, NOW)}`, "https://acme.zendesk.com/next"]);
    expect(collected.tickets.map(({ ticket }) => ticket.id)).toEqual([1, 2, 3]);
    expect(collected.skippedTicketIds).toEqual([5]);
    expect(calls.audits).toEqual([[1, undefined], [2, undefined], [3, undefined], [3, "audits?page=1"], [5, undefined]]);
    // The later copy of a ticket in the stream wins.
    expect(collected.tickets[0]!.ticket.subject).toBe('Refund "urgent", please\nsecond line');
    expect(calls.orgPages).toEqual(["start:0"]);
  });

  it("reads the official Jira links across cursor pages, skipping malformed rows", async () => {
    const { client, calls } = fakeClient();
    const collected = await collectZendeskExport(client, { sinceDays: 90, now: NOW });
    expect(calls.jiraPages).toEqual(["first", "c1"]);
    expect([...collected.jiraKeysByTicketId]).toEqual([["1", ["ENG-1", "ENG-2"]], ["3", ["ENG-9"]]]);
    expect(collected.jiraLinksUnavailable).toBe(false);
  });

  it("treats a denied or missing registry as unknown links, not a failed export", async () => {
    const { client } = fakeClient();
    client.fetchJiraLinksPage = async () => {
      throw new ZendeskApiError(404, "https://acme.zendesk.com/api/v2/jira/links");
    };
    const collected = await collectZendeskExport(client, { sinceDays: 90, now: NOW });
    expect(collected.jiraLinksUnavailable).toBe(true);
    expect(collected.jiraKeysByTicketId.size).toBe(0);
  });

  it("starts the incremental export at the window start", () => {
    expect(exportStartTime(1, NOW)).toBe(Date.parse("2026-09-16T00:00:00Z") / 1000);
  });
});

describe("status change rows", () => {
  it("are the audits' status Change events only, in time order", async () => {
    const collected = await collectZendeskExport(fakeClient().client, { sinceDays: 90, now: NOW });
    expect(statusChangeRows(collected).map((row) => [row.ticketId, row.auditId, row.previousValue, row.value])).toEqual([
      [1, 12, "new", "open"],
      [3, 31, "new", "open"],
      [3, 32, "open", "pending"],
      [3, 33, "pending", "solved"],
    ]);
  });
});

describe("export files", () => {
  it("escape CSV fields and round-trip through Concierge's parser", async () => {
    const collected = await collectZendeskExport(fakeClient().client, { sinceDays: 90, now: NOW });
    const files = buildZendeskConciergeExport(collected, {
      organizationId: "org-a",
      zendeskIntegrationId: "zendesk-a",
      subdomain: "acme",
      sinceDays: 90,
      exportedAt: NOW,
    });

    const tickets = parseCsv(files.ticketsCsv);
    expect(tickets.rows[0]).toEqual([
      "1", 'Refund "urgent", please\nsecond line', "open", "high", "2026-09-01T10:00:00Z", "2026-09-03T10:00:00Z", "Acme, Inc.", "900", "42", "email", "", "ENG-1 ENG-2",
    ]);
    expect(parseZendeskExport(tickets, parseCsv(files.auditsCsv), "UTC").cases.get("1")!.jiraKeys).toEqual(["ENG-1", "ENG-2"]);
    expect(files.ticketsCsv).toContain('"Refund ""urgent"", please\nsecond line"');
    expect(files.ticketsCsv).toContain('"Acme, Inc."');

    const parsed = parseZendeskExport(tickets, parseCsv(files.auditsCsv), "UTC");
    expect(parsed.ticketDrops.total).toBe(0);
    expect(parsed.auditDrops.total).toBe(0);
    expect(parsed.auditRowsUsed).toBe(4);
    expect(parsed.cases.get("1")!.organization).toBe("Acme, Inc.");
    expect(parsed.cases.get("3")!.events.map((event) => event.toState)).toContain("resolved");

    const zip = readStoredZip(files.zip);
    expect([...zip.keys()]).toEqual(["zendesk-tickets.csv", "zendesk-audits.csv", "metadata.json"]);
    expect(new TextDecoder().decode(zip.get("zendesk-audits.csv"))).toBe(files.auditsCsv);
    expect(JSON.parse(new TextDecoder().decode(zip.get("metadata.json")))).toMatchObject({
      format: "zendesk-concierge-export",
      organizationId: "org-a",
      zendeskIntegrationId: "zendesk-a",
      subdomain: "acme",
      ticketCount: 3,
      statusChangeCount: 4,
      skippedTicketIds: [5],
      jiraLinkCount: 3,
      jiraLinksUnavailable: false,
    });
  });
});
