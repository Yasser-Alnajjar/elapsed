import type { Prisma, PrismaClient } from "@sla/db";
import { createLogger, type Logger } from "@sla/logger";
import { ZendeskApiError, ZendeskClient } from "./client";
import type { ZendeskOAuthConfig } from "./oauth";
import {
  mapAuditToRawEvent,
  mapBusinessHoursScheduleToRawEvent,
  mapJiraLinkManifestToRawEvent,
  mapJiraLinkToRawEvent,
  mapOrganizationToRawEvent,
  mapScheduleHolidaysToRawEvent,
  mapSlaPolicyManifestToRawEvent,
  mapSlaPolicyToRawEvent,
  mapTicketToRawEvent,
  mapUserToRawEvent,
  type RawEventInput,
} from "./rawEvents";
import { loadFreshZendeskCredentials, refreshAfterUnauthorized } from "./tokenLifecycle";
import { markCaseDeletedForTicket } from "./webhook";
import type {
  ZendeskCursor,
  ZendeskIncrementalOrganizationExport,
  ZendeskIncrementalTicketExport,
  ZendeskScheduleHoliday,
} from "./types";

const DEFAULT_BACKFILL_DAYS = 90;
const INCREMENTAL_EXPORT_PAGE_SIZE = 1000; // Zendesk's fixed page size for these endpoints

export interface BackfillResult {
  ticketsFetched: number;
  ticketAuditsFetched: number;
  organizationsFetched: number;
  slaPoliciesFetched: number;
  businessHoursSchedulesFetched: number;
  jiraLinksFetched: number;
}

/**
 * Pulls tickets, ticket audits, organizations, and SLA policies into
 * RawEvent. Raw ingestion only — see `runZendeskNormalization` in
 * `./normalize` for RawEvent → NormalizedEvent/Case/Customer. Resumable: the
 * cursor is persisted after every page, so a crash or restart continues from
 * the last completed page rather than the start.
 */
export async function runZendeskBackfill(
  prisma: PrismaClient,
  integrationId: string,
  config: ZendeskOAuthConfig,
  // `logger` (roadmap 7.4): see `runCommitmentReResolutionPipeline`'s same
  // parameter — `cycle.ts` passes one already carrying cycle/organization
  // context, callers that don't (tests, other entry points) get a bare one.
  options: { sinceDays?: number; logger?: Logger } = {},
): Promise<BackfillResult> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  const logger = (options.logger ?? createLogger()).child({
    organizationId: integration.organizationId,
    integrationId,
    provider: "zendesk",
    stage: "backfill",
  });
  const cursor = ((integration.cursor as ZendeskCursor | null) ?? {}) as ZendeskCursor;
  const credentials = await loadFreshZendeskCredentials(prisma, integrationId, config);
  const client = new ZendeskClient(credentials, {
    onUnauthorized: (failed) => refreshAfterUnauthorized(prisma, integrationId, config, failed),
  });
  const sinceDays = options.sinceDays ?? DEFAULT_BACKFILL_DAYS;
  const defaultStartTime = Math.floor(Date.now() / 1000) - sinceDays * 24 * 60 * 60;

  const result: BackfillResult = {
    ticketsFetched: 0,
    ticketAuditsFetched: 0,
    organizationsFetched: 0,
    slaPoliciesFetched: 0,
    businessHoursSchedulesFetched: 0,
    jiraLinksFetched: 0,
  };

  await backfillTickets();
  await backfillOrganizations();
  await backfillSlaPolicies();
  await backfillBusinessHoursSchedules();
  await backfillJiraLinks();

  if (cursor.tickets && cursor.organizations) {
    cursor.backfillCompletedAt = new Date().toISOString();
    await persistCursor();
  }

  return result;

  async function backfillTickets(): Promise<void> {
    let startTime = cursor.tickets?.startTime ?? defaultStartTime;
    let nextPageUrl: string | null = null;

    for (;;) {
      const page: ZendeskIncrementalTicketExport = nextPageUrl
        ? await client.fetchTicketsNextPage(nextPageUrl)
        : await client.fetchTicketsPage(startTime);

      // Zendesk keeps deleted tickets in the incremental export for a period,
      // reduced to just `{id, status: "deleted", ...}` — the only signal this
      // stream ever gives that a previously-seen ticket is now gone. They
      // carry no meaningful audit history, so route them straight to
      // soft-deleting their Case instead of through the normal RawEvent path
      // (normalizeZendeskStatus has no mapping for "deleted" and would throw).
      const deletedTickets = page.tickets.filter((ticket) => ticket.status === "deleted");
      const liveTickets = page.tickets.filter((ticket) => ticket.status !== "deleted");

      for (const ticket of deletedTickets) {
        await markCaseDeletedForTicket(prisma, integrationId, ticket.id);
      }

      const rawEvents: RawEventInput[] = liveTickets.map((ticket) => mapTicketToRawEvent(ticket, page.users));
      await writeRawEvents(rawEvents);
      result.ticketsFetched += liveTickets.length;

      for (const ticket of liveTickets) {
        result.ticketAuditsFetched += await backfillAuditsForTicket(ticket.id);
      }

      startTime = page.end_time;
      cursor.tickets = { startTime };
      await persistCursor();

      if (page.count < INCREMENTAL_EXPORT_PAGE_SIZE || !page.next_page) break;
      nextPageUrl = page.next_page;
    }
  }

  async function backfillAuditsForTicket(ticketId: number): Promise<number> {
    let nextPageUrl: string | undefined;
    let count = 0;

    for (;;) {
      let page;
      try {
        page = await client.fetchTicketAuditsPage(ticketId, nextPageUrl);
      } catch (error) {
        // The incremental ticket export can list a ticket that is gone (permanently
        // deleted, merged away, or otherwise inaccessible) by the time we fetch its
        // audits — Zendesk returns 404 for that case. Skip this ticket's audits
        // rather than aborting the whole backfill run over one unreachable ticket.
        if (error instanceof ZendeskApiError && error.status === 404) {
          logger.warn("backfill_ticket_audits_not_found", { ticketId, status: 404 });
          await markCaseDeletedForTicket(prisma, integrationId, ticketId);
          return count;
        }
        throw error;
      }
      await writeRawEvents([...page.audits.map(mapAuditToRawEvent), ...(page.users ?? []).map(mapUserToRawEvent)]);
      count += page.audits.length;

      if (!page.next_page) break;
      nextPageUrl = page.next_page;
    }

    return count;
  }

  async function backfillOrganizations(): Promise<void> {
    let startTime = cursor.organizations?.startTime ?? defaultStartTime;
    let nextPageUrl: string | null = null;

    for (;;) {
      const page: ZendeskIncrementalOrganizationExport = nextPageUrl
        ? await client.fetchOrganizationsNextPage(nextPageUrl)
        : await client.fetchOrganizationsPage(startTime);

      await writeRawEvents(page.organizations.map(mapOrganizationToRawEvent));
      result.organizationsFetched += page.organizations.length;

      startTime = page.end_time;
      cursor.organizations = { startTime };
      await persistCursor();

      if (page.count < INCREMENTAL_EXPORT_PAGE_SIZE || !page.next_page) break;
      nextPageUrl = page.next_page;
    }
  }

  async function backfillSlaPolicies(): Promise<void> {
    let nextPageUrl: string | undefined;
    const seenPolicyIds: number[] = [];

    for (;;) {
      const page = await client.fetchSlaPoliciesPage(nextPageUrl);
      await writeRawEvents(page.sla_policies.map(mapSlaPolicyToRawEvent));
      seenPolicyIds.push(...page.sla_policies.map((p) => p.id));
      result.slaPoliciesFetched += page.sla_policies.length;

      if (!page.next_page) break;
      nextPageUrl = page.next_page;
    }

    // A full listing every run (see mapSlaPolicyManifestToRawEvent) — lets
    // the importer tell "deleted in Zendesk" apart from "not fetched yet".
    await writeRawEvents([mapSlaPolicyManifestToRawEvent(seenPolicyIds)]);
  }

  /**
   * The official Zendesk↔Jira integration's structured link registry — a
   * full, paginated listing re-fetched every run (like SLA policies) rather
   * than cursor-tracked, since Zendesk's `/api/v2/jira/links` carries no
   * incremental `start_time` filter. Paginated via `meta.has_more`/
   * `meta.after_cursor` (see `ZendeskJiraLinksPage`'s doc comment) — this
   * endpoint has no `next_page` URL. Any fetch failure here propagates like
   * every other list endpoint's (no try/catch swallowing it into an empty
   * page): the correlator that reads these RawEvents
   * (`runZendeskJiraLinkCorrelation`, ./correlate.ts) must never read "the
   * API errored" as "there are no Jira links."
   *
   * Also writes a full-manifest RawEvent of every link id seen this run
   * (mirrors `backfillSlaPolicies`'s `mapSlaPolicyManifestToRawEvent`) — the
   * only way the correlator can tell a ticket was unlinked in Zendesk apart
   * from "we haven't re-fetched it since it linked."
   */
  async function backfillJiraLinks(): Promise<void> {
    let afterCursor: string | undefined;
    const seenLinkIds: number[] = [];

    for (;;) {
      const page = await client.fetchJiraLinksPage(afterCursor);
      await writeRawEvents(page.links.map(mapJiraLinkToRawEvent));
      result.jiraLinksFetched += page.links.length;
      seenLinkIds.push(...page.links.map((l) => l.id));

      if (!page.meta?.has_more || !page.meta.after_cursor) break;
      afterCursor = page.meta.after_cursor;
    }

    await writeRawEvents([mapJiraLinkManifestToRawEvent(seenLinkIds)]);
  }

  /**
   * Schedules and their holidays are small, full snapshots re-fetched every
   * run (like SLA policies) rather than paginated/cursor-tracked — accounts
   * have few business hours schedules.
   */
  async function backfillBusinessHoursSchedules(): Promise<void> {
    const { schedules } = await client.fetchBusinessHoursSchedules();
    await writeRawEvents(schedules.map(mapBusinessHoursScheduleToRawEvent));
    result.businessHoursSchedulesFetched += schedules.length;

    for (const schedule of schedules) {
      const holidays = await fetchAllHolidays(schedule.id);
      await writeRawEvents([mapScheduleHolidaysToRawEvent({ scheduleId: schedule.id, holidays })]);
    }
  }

  async function fetchAllHolidays(scheduleId: number): Promise<ZendeskScheduleHoliday[]> {
    const holidays: ZendeskScheduleHoliday[] = [];
    let nextPageUrl: string | undefined;
    for (;;) {
      const page = await client.fetchScheduleHolidaysPage(scheduleId, nextPageUrl);
      holidays.push(...page.holidays);
      if (!page.next_page) break;
      nextPageUrl = page.next_page;
    }
    return holidays;
  }

  async function writeRawEvents(inputs: RawEventInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await prisma.rawEvent.createMany({
      data: inputs.map((input) => ({
        integrationId,
        providerEventId: input.providerEventId,
        sourceHash: input.sourceHash,
        payload: input.payload as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  async function persistCursor(): Promise<void> {
    await prisma.integration.update({
      where: { id: integrationId },
      data: { cursor: cursor as unknown as Prisma.InputJsonValue },
    });
  }
}
