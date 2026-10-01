import type { PrismaClient } from "@sla/db";
import type { Actor, CanonicalPriority, NormalizedEventType, NormalizedState } from "@sla/core";
import type {
  IntercomContact,
  IntercomConversationPart,
  IntercomConversationState,
  IntercomConversationWithParts,
} from "./types";
import type { CanonicalBatch, CaseFacts, CustomerIdentityFact, EventGroup, ProjectionFailure } from "@sla/ingestion";
import { intercomCompanyIdentity, intercomContactIdentity } from "./customer-identity";
import { INTERCOM_SOURCE_ROLE } from "./source-role";

/**
 * Intercom's closed, three-value conversation lifecycle, mapped to the
 * provider-independent vocabulary. A flatter mapping than Zendesk's six
 * statuses: Intercom has no separate "new" (a conversation starts "open") and
 * no distinct pending-customer/pending-internal split, so "snoozed" — an
 * agent deliberately deferring it — is the closest analog to
 * `pending_internal`.
 */
const STATE_TO_NORMALIZED_STATE: Record<IntercomConversationState, NormalizedState> = {
  open: "open",
  snoozed: "pending_internal",
  closed: "resolved",
};

export class UnknownIntercomStateError extends Error {
  constructor(state: string) {
    super(`Unknown Intercom conversation state: ${state}`);
    this.name = "UnknownIntercomStateError";
  }
}

export function normalizeIntercomState(state: string): NormalizedState {
  const mapped = STATE_TO_NORMALIZED_STATE[state as IntercomConversationState];
  if (!mapped) throw new UnknownIntercomStateError(state);
  return mapped;
}

/**
 * The subset of Intercom's wide `part_type` vocabulary (comment, note,
 * assignment, language_detection_details, conversation_rating_changed, ...)
 * that represents a state transition. Everything else is ignored, not an
 * error — unlike Zendesk's audit `Change` events, Intercom documents no
 * closed set of part types.
 */
const TRANSITION_PART_TYPE_TO_STATE: Record<string, IntercomConversationState> = {
  close: "closed",
  open: "open",
  snoozed: "snoozed",
};

/**
 * Part types that deliver a message to the customer when they carry a body:
 * a plain reply, or a reply sent together with a close/reopen/snooze/assign
 * ("reply and close"). Notes (`note`, `note_and_reopen`) are internal and
 * never count as a reply.
 */
const CUSTOMER_VISIBLE_REPLY_PART_TYPES = new Set(["comment", "close", "open", "snoozed", "assignment"]);

/**
 * Whether a part is a human agent's reply to the customer — what completes a
 * first-response commitment. Only `admin` authors count: bots and workflows
 * (`resolveIntercomActor`'s "system") are not a first response, and an
 * unrecognized author type is not guessed at.
 */
export function isAgentReplyPart(part: IntercomConversationPart): boolean {
  return part.author?.type === "admin" && isVisibleMessagePart(part);
}

/**
 * Whether a part is a customer's message on the conversation — a contact
 * (`resolveIntercomActor`'s "customer") writing into it after it opened. The
 * conversation's opening message is `conversation.source`, not a part, so it
 * never counts.
 */
export function isCustomerReplyPart(part: IntercomConversationPart): boolean {
  return resolveIntercomActor(part.author) === "customer" && isVisibleMessagePart(part);
}

export function isVisibleMessagePart(part: IntercomConversationPart): boolean {
  return (
    CUSTOMER_VISIBLE_REPLY_PART_TYPES.has(part.part_type) &&
    typeof part.body === "string" &&
    part.body.trim() !== ""
  );
}

/** One reply part's HTML body and author name, for conversation display only — never for SLA math. */
export interface IntercomMessageBody {
  authorName: string | null;
  /** HTML, same as `IntercomConversationPart.body` — the caller strips markup before rendering. */
  bodyHtml: string;
}

/**
 * A reply part's content, when it's a visible customer/agent message
 * (`isVisibleMessagePart` — the same test `isAgentReplyPart`/
 * `isCustomerReplyPart` use). Null for notes, transitions, and other part
 * types that never become `agent_replied`/`customer_replied`.
 */
export function extractIntercomMessageBody(part: IntercomConversationPart): IntercomMessageBody | null {
  if (!isVisibleMessagePart(part)) return null;
  return { authorName: part.author?.name?.trim() || null, bodyHtml: part.body as string };
}

/** Channels Intercom uses when an automation/workflow made the change, not a person. */
const SYSTEM_AUTHOR_TYPES = new Set(["bot", "team", "operator"]);

/**
 * Best-effort actor resolution: a bot/automation author is "system", an admin
 * is "agent", and a contact (Intercom's "user"/"lead"/"contact" author types)
 * is "customer". Defaults to "agent" for anything unrecognized, mirroring
 * `resolveActor` in @sla/zendesk — most conversation activity is agent-side.
 */
export function resolveIntercomActor(author: { type: string } | null | undefined): Actor {
  if (!author) return "system";
  if (SYSTEM_AUTHOR_TYPES.has(author.type)) return "system";
  if (author.type === "user" || author.type === "lead" || author.type === "contact") return "customer";
  return "agent";
}

export interface ConversationPartRecord {
  /** The RawEvent row id this part was read from — becomes NormalizedEvent.sourceRawEventId. */
  rawEventId: string;
  part: IntercomConversationPart;
}

export interface DerivedNormalizedEvent {
  type: NormalizedEventType;
  occurredAt: string;
  actor: Actor;
  fromState: NormalizedState | null;
  toState: NormalizedState | null;
  sourceRawEventId: string;
  /**
   * Position in the conversation's own source order: 0 for the synthesized
   * `case_created`, then per part in part order (`sortPartsChronologically`),
   * with a part's transition before the reply the same part carries.
   */
  sourceSequence: number;
}

export function sortPartsChronologically(parts: ConversationPartRecord[]): ConversationPartRecord[] {
  return [...parts].sort((a, b) => {
    const byTime = a.part.created_at - b.part.created_at;
    return byTime !== 0 ? byTime : a.part.id.localeCompare(b.part.id);
  });
}

/**
 * `RawEvent` → `NormalizedEvent` for one conversation. Regenerated from
 * scratch on every run (never diffed incrementally), mirroring
 * `deriveNormalizedEventsForTicket` in @sla/zendesk.
 *
 * Unlike Zendesk's audit `Change` events, an Intercom conversation part
 * carries no explicit before/after state — a "close" part just says "this
 * closed now". So the derivation replays parts chronologically, tracking the
 * conversation's own running state starting from "open" (every conversation
 * starts open) rather than reading an explicit previous value off each event.
 * A transition part whose target state matches the currently-tracked state
 * (a redundant re-close, say) is skipped rather than emitted as a no-op.
 *
 * Admin replies (`isAgentReplyPart`) additionally become `agent_replied`
 * events, and customer messages (`isCustomerReplyPart`) `customer_replied`,
 * independently of any transition the same part carries. Events
 * keep the parts' source order; a part carrying both a transition and a
 * reply emits the transition first. `sourceSequence` records that order so
 * it survives persistence (see `compareNormalizedEvents` in @sla/core).
 */
export function deriveNormalizedEventsForConversation(
  conversation: IntercomConversationWithParts,
  partsForConversation: ConversationPartRecord[],
  conversationRawEventId: string,
): DerivedNormalizedEvent[] {
  const sorted = sortPartsChronologically(partsForConversation);

  const events: DerivedNormalizedEvent[] = [
    {
      type: "case_created",
      occurredAt: new Date(conversation.created_at * 1000).toISOString(),
      actor: resolveIntercomActor(conversation.source?.author),
      fromState: null,
      toState: normalizeIntercomState("open"),
      sourceRawEventId: conversationRawEventId,
      sourceSequence: 0,
    },
  ];

  let currentState: IntercomConversationState = "open";
  let sourceSequence = 0;
  for (const { rawEventId, part } of sorted) {
    const occurredAt = new Date(part.created_at * 1000).toISOString();

    sourceSequence += 1;
    const targetState = TRANSITION_PART_TYPE_TO_STATE[part.part_type];
    if (targetState !== undefined && targetState !== currentState) {
      const toState = normalizeIntercomState(targetState);
      events.push({
        // Intercom's only terminal state is "closed" — a conversation reopened
        // after that (targetState "open") is a plain state_changed, same as
        // Zendesk's solved-then-reopened case.
        type: toState === "resolved" ? "case_closed" : "state_changed",
        occurredAt,
        actor: resolveIntercomActor(part.author),
        fromState: normalizeIntercomState(currentState),
        toState,
        sourceRawEventId: rawEventId,
        sourceSequence,
      });
      currentState = targetState;
    }

    sourceSequence += 1;
    const replyType = isAgentReplyPart(part) ? "agent_replied" : isCustomerReplyPart(part) ? "customer_replied" : null;
    if (replyType) {
      events.push({
        type: replyType,
        occurredAt,
        actor: replyType === "agent_replied" ? "agent" : "customer",
        fromState: null,
        toState: null,
        sourceRawEventId: rawEventId,
        sourceSequence,
      });
    }
  }

  // Emitted in source order already; the sort only guards the synthesized
  // case_created against a part timestamped before the conversation itself.
  return events.sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceSequence - b.sourceSequence,
  );
}

/**
 * `Case.closedAt` for a conversation: set once it reaches Intercom's one
 * terminal state ("closed"), timestamped from the most recent transition
 * into it — mirrors `deriveCaseClosedAt` in @sla/zendesk. Falls back to
 * `conversation.updated_at` when no case_closed event was derived at all — a
 * conversation fetched for the first time already closed, with no part
 * history recorded for the transition.
 */
export function deriveCaseClosedAt(
  conversation: IntercomConversationWithParts,
  derivedEvents: DerivedNormalizedEvent[],
): Date | null {
  if (conversation.state !== "closed") return null;

  const closureEvent = [...derivedEvents].reverse().find((event) => event.type === "case_closed");
  return closureEvent ? new Date(closureEvent.occurredAt) : new Date(conversation.updated_at * 1000);
}

/**
 * Intercom's binary conversation priority, mapped onto `CanonicalPriority`
 * (@sla/core), the vocabulary SLA policies match on (`{ priority: ["normal"] }`, etc.) — left
 * raw, "not_priority"/"priority" would match no policy, so an Intercom case
 * would never get commitments and never reach the dashboard.
 */
const PRIORITY_TO_CANONICAL_PRIORITY: Record<string, CanonicalPriority> = {
  priority: "high",
  not_priority: "normal",
};

export function normalizeIntercomPriority(priority: string | null | undefined): string | null {
  if (!priority) return null;
  return PRIORITY_TO_CANONICAL_PRIORITY[priority] ?? priority;
}

const MAX_MESSAGE_SUBJECT_LENGTH = 120;

/** Message HTML → one line of plain text, cut to a subject-sized length. */
function messageHtmlToSubject(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Bare links (inline image/attachment URLs) say nothing as a subject.
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  return text.length > MAX_MESSAGE_SUBJECT_LENGTH ? `${text.slice(0, MAX_MESSAGE_SUBJECT_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * Display subject for a conversation: its own title, else the ticket's
 * title attribute (Intercom tickets keep it there, often AI-generated), else
 * the opening message's email subject. A plain chat that was never made a
 * ticket has none of those, so it falls back to the opening message's text,
 * then the first customer comment with any text. Null when all are empty.
 */
export function deriveIntercomSubject(
  conversation: IntercomConversationWithParts,
  partsForConversation: ConversationPartRecord[] = [],
): string | null {
  const ticketTitle = conversation.ticket?.custom_attributes?._default_title_?.value;
  const explicit = [conversation.title, ticketTitle, conversation.source?.subject].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (explicit) return explicit.trim();

  const openingMessage = messageHtmlToSubject(conversation.source?.body);
  if (openingMessage) return openingMessage;

  for (const { part } of sortPartsChronologically(partsForConversation)) {
    if (part.part_type !== "comment" || resolveIntercomActor(part.author) !== "customer") continue;
    const text = messageHtmlToSubject(part.body);
    if (text) return text;
  }
  return null;
}

/**
 * Keeps, per string `id` embedded in each row's JSON payload, the row with
 * the latest fetchedAt. `rawEventIds` lists every snapshot row seen for that
 * id (not just the latest), so a regenerate-in-place delete can also clear
 * events an older snapshot sourced.
 */
function latestSnapshotById<T extends { id: string }>(
  rows: { id: string; payload: unknown; fetchedAt: Date }[],
): Map<string, { rawEventId: string; value: T; fetchedAt: Date; rawEventIds: string[] }> {
  const byId = new Map<string, { rawEventId: string; value: T; fetchedAt: Date; rawEventIds: string[] }>();
  for (const row of rows) {
    const value = row.payload as T;
    const existing = byId.get(value.id);
    const rawEventIds = [...(existing?.rawEventIds ?? []), row.id];
    if (!existing || row.fetchedAt >= existing.fetchedAt) {
      byId.set(value.id, { rawEventId: row.id, value, fetchedAt: row.fetchedAt, rawEventIds });
    } else {
      existing.rawEventIds = rawEventIds;
    }
  }
  return byId;
}

/** `conversation_part:{conversationId}:{partId}` — parts carry no conversation id of their own. */
function groupPartsByConversationId(
  rows: { id: string; providerEventId: string; payload: unknown }[],
): Map<string, ConversationPartRecord[]> {
  const byConversationId = new Map<string, ConversationPartRecord[]>();
  for (const row of rows) {
    const conversationId = row.providerEventId.split(":")[1];
    if (!conversationId) continue;
    const record: ConversationPartRecord = { rawEventId: row.id, part: row.payload as IntercomConversationPart };
    const group = byConversationId.get(conversationId);
    if (group) group.push(record);
    else byConversationId.set(conversationId, [record]);
  }
  return byConversationId;
}

/**
 * Derives, from everything ingested so far for one integration, the customers,
 * cases and events the shared projector persists (`CanonicalBatch`). Writes
 * nothing. Idempotent: the same raw events always give the same batch, and the
 * projector writes only the difference.
 *
 * A conversation's customer is resolved by following its primary contact
 * (`conversation.contacts.contacts[0]`) to that contact's first company —
 * Intercom conversations carry no company id directly, unlike a Zendesk
 * ticket's `organization_id`. A contact with no company becomes its own
 * contact-keyed customer; only a conversation with no contact at all gets a
 * case with no customer.
 */
export async function buildIntercomBatch(prisma: PrismaClient, integrationId: string): Promise<CanonicalBatch> {
  const [companyRows, contactRows, conversationRows, partRows, adminRows] = await Promise.all([
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "company:" } },
      select: { id: true, payload: true, fetchedAt: true },
      orderBy: { fetchedAt: "asc" },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "contact:" } },
      select: { id: true, payload: true, fetchedAt: true },
      orderBy: { fetchedAt: "asc" },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "conversation:" } },
      select: { id: true, payload: true, fetchedAt: true },
      orderBy: { fetchedAt: "asc" },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "conversation_part:" } },
      select: { id: true, providerEventId: true, payload: true },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "admin:" } },
      select: { id: true, payload: true, fetchedAt: true },
      orderBy: { fetchedAt: "asc" },
    }),
  ]);

  // `admin_assignee_id` -> display name (D10/3.6). Absent until the next
  // backfill/cycle has fetched the admin list at least once.
  const adminNamesById = new Map(
    [...latestSnapshotById<{ id: string; name: string | null }>(adminRows).values()].map(({ value }) => [
      value.id,
      value.name,
    ]),
  );

  const latestCompanies = latestSnapshotById<{ id: string; name: string }>(companyRows);
  const companyCustomers: CustomerIdentityFact[] = [...latestCompanies.values()].map(({ value: company }) => ({
    ...intercomCompanyIdentity(company.id),
    name: company.name,
  }));
  // Keyed by contact id so one person's conversations share one customer; the
  // last conversation's name wins, as when each conversation upserted it.
  const contactCustomers = new Map<string, CustomerIdentityFact>();

  const latestContacts = latestSnapshotById<IntercomContact>(contactRows);
  const latestConversations = latestSnapshotById<IntercomConversationWithParts>(conversationRows);
  const partsByConversationId = groupPartsByConversationId(partRows);

  const cases: CaseFacts[] = [];
  const eventGroups: EventGroup[] = [];
  const failures: ProjectionFailure[] = [];

  for (const {
    rawEventId: conversationRawEventId,
    value: conversation,
    rawEventIds: conversationSnapshotRawEventIds,
  } of latestConversations.values()) {
    try {
      const primaryContactId = conversation.contacts?.contacts[0]?.id;
      const primaryContact = primaryContactId ? latestContacts.get(primaryContactId)?.value : undefined;
      const companyId = primaryContact?.companies?.data[0]?.id;
      let customer: CaseFacts["customer"] = null;
      if (companyId) {
        customer = intercomCompanyIdentity(companyId);
      } else if (primaryContactId) {
        const author = conversation.source?.author;
        const authorName = author?.id === primaryContactId ? author.name || author.email : undefined;
        const name =
          primaryContact?.name || primaryContact?.email || authorName || `Intercom contact ${primaryContactId}`;
        contactCustomers.set(primaryContactId, { ...intercomContactIdentity(primaryContactId), name });
        customer = intercomContactIdentity(primaryContactId);
      }

      const assigneeName =
        conversation.admin_assignee_id != null
          ? (adminNamesById.get(String(conversation.admin_assignee_id)) ?? null)
          : null;

      const partsForConversation = partsByConversationId.get(conversation.id) ?? [];
      const subject = deriveIntercomSubject(conversation, partsForConversation);
      const derived = deriveNormalizedEventsForConversation(conversation, partsForConversation, conversationRawEventId);
      const closedAt = deriveCaseClosedAt(conversation, derived);

      cases.push({
        externalId: conversation.id,
        subject,
        assigneeName,
        priority: normalizeIntercomPriority(conversation.priority),
        channel: conversation.source?.type ?? null,
        openedAt: new Date(conversation.created_at * 1000),
        closedAt,
        customer,
      });
      eventGroups.push({
        target: { caseExternalId: conversation.id },
        // Every RawEvent this conversation's own derivation could ever have
        // sourced an event from — every conversation snapshot (each changed
        // re-fetch is a new RawEvent; an older one's case_created must not
        // linger as a duplicate) plus its parts. Scoping the reconcile to just
        // these keeps it from touching events another provider wrote onto the
        // same case.
        ownRawEventIds: [...conversationSnapshotRawEventIds, ...partsForConversation.map((p) => p.rawEventId)],
        events: derived.map((event) => ({
          type: event.type,
          occurredAt: new Date(event.occurredAt),
          actor: event.actor,
          sourceRole: INTERCOM_SOURCE_ROLE,
          fromState: event.fromState,
          toState: event.toState,
          sourceRawEventId: event.sourceRawEventId,
          sourceSequence: event.sourceSequence,
        })),
        recordId: conversation.id,
      });
    } catch (error) {
      failures.push({ id: conversation.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    customers: [...companyCustomers, ...contactCustomers.values()],
    cases,
    eventGroups,
    deletedCaseExternalIds: [],
    failures,
  };
}
