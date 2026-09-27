import {
  ZendeskApiError,
  parseJiraLinkRecord,
  type ZendeskAudit,
  type ZendeskClient,
  type ZendeskTicket,
} from "@sla/zendesk";
import { buildCsv } from "./csv";
import type { ZendeskConciergeExportMetadata } from "./types/concierge-export";
import { createZip } from "./zip";

/**
 * Zendesk half of a Concierge dataset (`apps/concierge`), pulled live through
 * the organization's connected integration. Writes the column layout
 * `apps/concierge/src/zendesk.ts` reads (`TICKET_COLUMNS`, `AUDIT_COLUMNS`),
 * so the files go straight into `--zendesk-tickets` / `--zendesk-audits`.
 *
 * Status history comes only from the Ticket Audits API: one row per `Change`
 * event on the `status` field. Nothing is inferred from a ticket's current
 * status or `updated_at`. Walks the same endpoints, in the same way, as
 * `runZendeskBackfill` and `apps/concierge/scripts/export-zendesk-concierge.ts`.
 */

export const ZENDESK_TICKETS_FILE = "zendesk-tickets.csv";
export const ZENDESK_AUDITS_FILE = "zendesk-audits.csv";
export const ZENDESK_METADATA_FILE = "metadata.json";
export const ZENDESK_EXPORT_ZIP_FILE = "zendesk-concierge-export.zip";

/** Zendesk's fixed page size for incremental exports; a shorter page is the last one. */
const INCREMENTAL_EXPORT_PAGE_SIZE = 1000;

export type ZendeskExportClient = Pick<
  ZendeskClient,
  "fetchTicketsPage" | "fetchTicketsNextPage" | "fetchOrganizationsPage" | "fetchOrganizationsNextPage" | "fetchTicketAuditsPage" | "fetchJiraLinksPage"
>;

export interface ZendeskTicketExport {
  ticket: ZendeskTicket;
  audits: ZendeskAudit[];
}

export interface CollectedZendeskExport {
  startTime: number;
  tickets: ZendeskTicketExport[];
  organizationNames: Map<number, string>;
  /** Official Zendesk↔Jira links (`/api/v2/jira/links`), ticket id → Jira issue keys. The authoritative signal Concierge correlates on. */
  jiraKeysByTicketId: Map<string, string[]>;
  /** The registry couldn't be read (Zendesk's Jira integration isn't installed, or access was denied), so links are unknown rather than absent. */
  jiraLinksUnavailable: boolean;
  /** Listed by the ticket export, but their audits were gone (404) by the time they were fetched. */
  skippedTicketIds: number[];
}

export function exportStartTime(sinceDays: number, now: Date = new Date()): number {
  return Math.floor((now.getTime() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
}

export async function collectZendeskExport(
  client: ZendeskExportClient,
  options: { sinceDays: number; now?: Date },
): Promise<CollectedZendeskExport> {
  const startTime = exportStartTime(options.sinceDays, options.now);

  const ticketsById = new Map<number, ZendeskTicket>();
  let page = await client.fetchTicketsPage(startTime);
  for (;;) {
    for (const ticket of page.tickets) {
      // Deleted tickets stay in the incremental export as stubs with no audits.
      if (ticket.status === "deleted") ticketsById.delete(ticket.id);
      else ticketsById.set(ticket.id, ticket);
    }
    if (page.count < INCREMENTAL_EXPORT_PAGE_SIZE || !page.next_page) break;
    page = await client.fetchTicketsNextPage(page.next_page);
  }

  const tickets: ZendeskTicketExport[] = [];
  const skippedTicketIds: number[] = [];
  for (const ticket of [...ticketsById.values()].sort((a, b) => a.id - b.id)) {
    const audits = await fetchAllAudits(client, ticket.id);
    if (audits === null) skippedTicketIds.push(ticket.id);
    else tickets.push({ ticket, audits });
  }

  const { jiraKeysByTicketId, unavailable } = await fetchJiraKeysByTicketId(client);
  return {
    startTime,
    tickets,
    organizationNames: await fetchOrganizationNames(client),
    jiraKeysByTicketId,
    jiraLinksUnavailable: unavailable,
    skippedTicketIds,
  };
}

/** Walks the cursor-paginated registry the way `runZendeskBackfill` does. */
async function fetchJiraKeysByTicketId(
  client: ZendeskExportClient,
): Promise<{ jiraKeysByTicketId: Map<string, string[]>; unavailable: boolean }> {
  const jiraKeysByTicketId = new Map<string, string[]>();
  let afterCursor: string | undefined;
  try {
    for (;;) {
      const page = await client.fetchJiraLinksPage(afterCursor);
      for (const link of page.links) {
        const parsed = parseJiraLinkRecord(link);
        if (!parsed) continue;
        const keys = jiraKeysByTicketId.get(parsed.ticketId) ?? [];
        if (!keys.includes(parsed.issueKey)) keys.push(parsed.issueKey);
        jiraKeysByTicketId.set(parsed.ticketId, keys);
      }
      if (!page.meta?.has_more || !page.meta.after_cursor) break;
      afterCursor = page.meta.after_cursor;
    }
  } catch (error) {
    if (error instanceof ZendeskApiError && (error.status === 403 || error.status === 404)) {
      return { jiraKeysByTicketId: new Map(), unavailable: true };
    }
    throw error;
  }
  return { jiraKeysByTicketId, unavailable: false };
}

async function fetchAllAudits(client: ZendeskExportClient, ticketId: number): Promise<ZendeskAudit[] | null> {
  const audits: ZendeskAudit[] = [];
  let nextPageUrl: string | undefined;
  for (;;) {
    let page;
    try {
      page = await client.fetchTicketAuditsPage(ticketId, nextPageUrl);
    } catch (error) {
      // Deleted or merged away between the ticket export and this call.
      if (error instanceof ZendeskApiError && error.status === 404) return null;
      throw error;
    }
    audits.push(...page.audits);
    if (!page.next_page) return audits;
    nextPageUrl = page.next_page;
  }
}

/** Every organization's name, so the tickets CSV can say which customer a ticket is for. */
async function fetchOrganizationNames(client: ZendeskExportClient): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  let page = await client.fetchOrganizationsPage(0);
  for (;;) {
    for (const organization of page.organizations) names.set(organization.id, organization.name);
    if (page.count < INCREMENTAL_EXPORT_PAGE_SIZE || !page.next_page) break;
    page = await client.fetchOrganizationsNextPage(page.next_page);
  }
  return names;
}

export function ticketsToCsv(collected: CollectedZendeskExport): string {
  return buildCsv(
    ["Id", "Subject", "Status", "Priority", "Created at", "Updated at", "Organization", "Organization ID", "Requester ID", "Via", "External ID", "Jira issue keys"],
    collected.tickets.map(({ ticket }) => [
      ticket.id,
      ticket.subject ?? "",
      ticket.status,
      ticket.priority ?? "",
      ticket.created_at,
      ticket.updated_at,
      ticket.organization_id != null ? (collected.organizationNames.get(ticket.organization_id) ?? "") : "",
      ticket.organization_id ?? "",
      ticket.requester_id ?? "",
      ticket.via?.channel ?? "",
      ticket.external_id ?? "",
      (collected.jiraKeysByTicketId.get(String(ticket.id)) ?? []).join(" "),
    ]),
  );
}

export interface StatusChangeRow {
  ticketId: number;
  auditId: number;
  createdAt: string;
  previousValue: string;
  value: string;
  authorId: number | string;
  via: string;
}

/** One row per status `Change` event, oldest first within each ticket. */
export function statusChangeRows(collected: CollectedZendeskExport): StatusChangeRow[] {
  const rows: StatusChangeRow[] = [];
  for (const { ticket, audits } of collected.tickets) {
    const ordered = [...audits].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
    for (const audit of ordered) {
      for (const event of audit.events) {
        if (event.type !== "Change" || event.field_name !== "status") continue;
        rows.push({
          ticketId: ticket.id,
          auditId: audit.id,
          createdAt: audit.created_at,
          previousValue: String(event.previous_value ?? ""),
          value: String(event.value ?? ""),
          authorId: audit.author_id ?? "",
          via: audit.via?.channel ?? "",
        });
      }
    }
  }
  return rows;
}

export function auditsToCsv(rows: StatusChangeRow[]): string {
  return buildCsv(
    ["Ticket ID", "Audit ID", "Created at", "Field", "Previous value", "Value", "Author ID", "Via"],
    rows.map((row) => [row.ticketId, row.auditId, row.createdAt, "status", row.previousValue, row.value, row.authorId, row.via]),
  );
}

export interface ZendeskConciergeExportFiles {
  ticketsCsv: string;
  auditsCsv: string;
  metadata: ZendeskConciergeExportMetadata;
  zip: Uint8Array;
}

export function buildZendeskConciergeExport(
  collected: CollectedZendeskExport,
  context: { organizationId: string; zendeskIntegrationId: string; subdomain: string; sinceDays: number; exportedAt?: Date },
): ZendeskConciergeExportFiles {
  const ticketsCsv = ticketsToCsv(collected);
  const rows = statusChangeRows(collected);
  const auditsCsv = auditsToCsv(rows);
  const metadata: ZendeskConciergeExportMetadata = {
    format: "zendesk-concierge-export",
    version: 1,
    exportedAt: (context.exportedAt ?? new Date()).toISOString(),
    organizationId: context.organizationId,
    zendeskIntegrationId: context.zendeskIntegrationId,
    subdomain: context.subdomain,
    startTime: collected.startTime,
    sinceDays: context.sinceDays,
    ticketCount: collected.tickets.length,
    statusChangeCount: rows.length,
    jiraLinkCount: [...collected.jiraKeysByTicketId.values()].reduce((sum, keys) => sum + keys.length, 0),
    jiraLinksUnavailable: collected.jiraLinksUnavailable,
    skippedTicketIds: collected.skippedTicketIds,
    files: [ZENDESK_TICKETS_FILE, ZENDESK_AUDITS_FILE, ZENDESK_METADATA_FILE],
  };
  const encoder = new TextEncoder();
  const zip = createZip(
    [
      { name: ZENDESK_TICKETS_FILE, data: encoder.encode(ticketsCsv) },
      { name: ZENDESK_AUDITS_FILE, data: encoder.encode(auditsCsv) },
      { name: ZENDESK_METADATA_FILE, data: encoder.encode(JSON.stringify(metadata, null, 2) + "\n") },
    ],
    context.exportedAt,
  );
  return { ticketsCsv, auditsCsv, metadata, zip };
}
