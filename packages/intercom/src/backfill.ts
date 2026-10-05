import type { Prisma, PrismaClient } from "@sla/db";
import { IntercomApiError, IntercomClient } from "./client";
import {
  mapAdminToRawEvent,
  mapCompanyToRawEvent,
  mapContactToRawEvent,
  mapConversationPartToRawEvent,
  mapConversationToRawEvent,
  mapTicketStatePartToRawEvent,
  type RawEventInput,
} from "./rawEvents";
import { loadFreshIntercomCredentials, markReauthRequired, recordIntercomWorkspaceId } from "./tokenLifecycle";
import { INTERCOM_TICKET_STATE_PART_TYPE_PREFIX, type IntercomConversationWithParts, type IntercomCursor } from "./types";

const DEFAULT_BACKFILL_DAYS = 90;

/**
 * How far behind a run's start the next run's `updated_at` filter reaches.
 * Intercom's conversation search can lag behind a change, so a watermark set
 * to the run start skips an update the search had not indexed yet, for good.
 * Re-fetching a conversation that has not changed is harmless: its raw event
 * dedupes on the content hash.
 */
export const WATERMARK_LOOKBACK_SECONDS = 5 * 60;

export interface BackfillResult {
  conversationsFetched: number;
  conversationPartsFetched: number;
  contactsFetched: number;
  companiesFetched: number;
  adminsFetched: number;
}

/**
 * Pulls conversations, conversation parts (status transitions), contacts (for
 * company resolution), and companies into RawEvent. Raw ingestion only — see
 * `buildIntercomBatch` in ./normalize for RawEvent →
 * NormalizedEvent/Case/Customer. Resumable: the cursor is persisted after
 * every page, so a crash or restart continues from the last completed page
 * rather than the start. Mirrors `runZendeskBackfill`'s shape, but Intercom's
 * search API is cursor-paginated (`starting_after`) rather than
 * time-windowed, so watermark advancement follows `runLinearBackfill`'s
 * pattern instead.
 */
export async function runIntercomBackfill(
  prisma: PrismaClient,
  integrationId: string,
  options: { sinceDays?: number } = {},
): Promise<BackfillResult> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  const cursor = ((integration.cursor as IntercomCursor | null) ?? {}) as IntercomCursor;
  const credentials = await loadFreshIntercomCredentials(prisma, integrationId);
  const client = new IntercomClient(credentials, {
    onUnauthorized: (failed) => markReauthRequired(prisma, integrationId, failed),
  });
  const sinceDays = options.sinceDays ?? DEFAULT_BACKFILL_DAYS;
  const defaultUpdatedSince = Math.floor(Date.now() / 1000) - sinceDays * 24 * 60 * 60;
  const runStartedAt = Math.floor(Date.now() / 1000);

  const result: BackfillResult = {
    conversationsFetched: 0,
    conversationPartsFetched: 0,
    contactsFetched: 0,
    companiesFetched: 0,
    adminsFetched: 0,
  };
  const contactIdsFetchedThisRun = new Set<string>();

  await recordWorkspaceIdIfMissing();
  await backfillConversations();
  await backfillCompanies();
  await backfillAdmins();

  cursor.backfillCompletedAt = new Date().toISOString();
  await persistCursor();

  return result;

  /** One-time `/me` lookup so the web app can link cases back to the Intercom inbox. */
  async function recordWorkspaceIdIfMissing(): Promise<void> {
    if (credentials.workspaceId) return;
    try {
      const workspaceId = (await client.fetchMe()).app?.id_code;
      if (workspaceId) await recordIntercomWorkspaceId(prisma, integrationId, credentials, workspaceId);
    } catch (error) {
      // Only a missing link is at stake — never fail (or flag permission loss
      // on) the sync for it. A revoked token still surfaces via the reauth
      // error, which isn't an IntercomApiError, and the next request anyway.
      if (!(error instanceof IntercomApiError)) throw error;
    }
  }

  async function backfillConversations(): Promise<void> {
    const updatedSince = cursor.conversations?.updatedSince ?? defaultUpdatedSince;
    let startingAfter = cursor.conversations?.startingAfter;

    for (;;) {
      const page = await client.searchConversations(updatedSince, startingAfter);

      for (const summary of page.conversations) {
        // The search result is a summary with no conversation_parts — refetch
        // each conversation individually for the full thread, mirroring how
        // ZendeskClient fetches a ticket's audits as a separate call.
        const full = await client.fetchConversation(summary.id);
        await writeRawEvents([mapConversationToRawEvent(full)]);
        result.conversationsFetched += 1;

        const parts = full.conversation_parts?.conversation_parts ?? [];
        await writeRawEvents(parts.map((part) => mapConversationPartToRawEvent(full.id, part)));
        result.conversationPartsFetched += parts.length;

        await backfillTicketStateParts(full);

        const primaryContactId = full.contacts?.contacts[0]?.id;
        if (primaryContactId && !contactIdsFetchedThisRun.has(primaryContactId)) {
          contactIdsFetchedThisRun.add(primaryContactId);
          const contact = await client.fetchContact(primaryContactId);
          await writeRawEvents([mapContactToRawEvent(contact)]);
          result.contactsFetched += 1;
        }
      }

      startingAfter = page.pages.next?.starting_after;
      cursor.conversations = { updatedSince, startingAfter };
      await persistCursor();

      if (!startingAfter) break;
    }

    // The window just scanned is written; advance the watermark to the run
    // start less the look-back (see WATERMARK_LOOKBACK_SECONDS), never past
    // the filter this run already used.
    cursor.conversations = {
      updatedSince: Math.max(updatedSince, runStartedAt - WATERMARK_LOOKBACK_SECONDS),
      startingAfter: undefined,
    };
    await persistCursor();
  }

  /**
   * A ticket's "Waiting on customer" is a ticket state, not a conversation
   * state, and its conversation part names no target state — so a ticket
   * whose thread has a state-change part is fetched once more from the ticket
   * API for the state each such part moved it to. Best-effort: a failure
   * (including a 403 if the app lacks ticket access) must not fail or flag the
   * conversation sync, so it is skipped until the conversation next changes;
   * normalization falls back to the snapshot's current `ticket.state`.
   */
  async function backfillTicketStateParts(full: IntercomConversationWithParts): Promise<void> {
    const hasTicketStatePart = (full.conversation_parts?.conversation_parts ?? []).some((part) =>
      part.part_type.startsWith(INTERCOM_TICKET_STATE_PART_TYPE_PREFIX),
    );
    if (!full.ticket || !hasTicketStatePart) return;

    try {
      const ticket = await client.fetchTicket(String(full.ticket.id ?? full.id));
      const stateParts = (ticket.ticket_parts?.ticket_parts ?? []).filter((part) => typeof part.ticket_state === "string");
      await writeRawEvents(stateParts.map((part) => mapTicketStatePartToRawEvent(full.id, part)));
    } catch (error) {
      if (!(error instanceof IntercomApiError)) throw error;
    }
  }

  /** Small, full snapshot every run (like Zendesk's business hours schedules) — accounts have few companies. */
  async function backfillCompanies(): Promise<void> {
    let page = 1;
    for (;;) {
      const companiesPage = await client.fetchCompaniesPage(page);
      await writeRawEvents(companiesPage.data.map(mapCompanyToRawEvent));
      result.companiesFetched += companiesPage.data.length;

      if (page >= companiesPage.pages.total_pages) break;
      page += 1;
    }
  }

  /** Small, full snapshot every run (like companies) — resolves `admin_assignee_id` to a name (D10/3.6). Not paginated; workspaces have few teammates. */
  async function backfillAdmins(): Promise<void> {
    const admins = await client.fetchAdmins();
    await writeRawEvents(admins.admins.map(mapAdminToRawEvent));
    result.adminsFetched += admins.admins.length;
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
