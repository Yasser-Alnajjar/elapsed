import type { ConversationEventRef, ConversationInput, ConversationMessage } from "@sla/ingestion";
import { publicCommentBodiesInAudit, type ZendeskCommentBody } from "./normalize";
import type { ZendeskAudit } from "./types";

/** `providerEventId` prefix of the ticket's snapshots, the raw events `renderZendeskConversation` reads for the opening message. */
export const zendeskConversationContext = (externalId: string): string[] => [`ticket:${externalId}:`];

type ReplyEvent = ConversationEventRef & { actor: "customer" | "agent"; type: "agent_replied" | "customer_replied" };

const isReplyEvent = (event: ConversationEventRef): event is ReplyEvent =>
  event.type === "agent_replied" || event.type === "customer_replied";

/**
 * The case's full public conversation: every `agent_replied`/
 * `customer_replied` event (in the engine's order, with SLA relevance
 * irrelevant to inclusion — an event that fed no commitment still appears
 * here) paired with the comment text its source audit carries. Private notes
 * are out of scope: they are never derived into a NormalizedEvent to begin
 * with (see `isPublicCommentEvent`), so there is no normalized record to read
 * one from yet.
 *
 * Prepended with the ticket's own opening message — the description an
 * email-created ticket carries, which `deriveNormalizedEventsForTicket`
 * deliberately never turns into an `agent_replied`/`customer_replied` event
 * (comments on the creation audit never count, so first-response/next-reply
 * SLA math can't see it either — this stays purely a display concern).
 */
export function renderZendeskConversation({ case: caseRow, events, payloads, context }: ConversationInput): ConversationMessage[] {
  const replyEvents = events.filter(isReplyEvent);

  // The ticket's own requester id, so a customer message can be attributed
  // to the case's already-known `requesterName` — never guessed for anyone
  // else. Zendesk's audit sideload only ever stores a comment author's role
  // (see `mapUserToRawEvent`'s privacy-minimization comment), never their
  // name, so any other author stays unnamed.
  const ticketPayload = context[0] as { requester_id?: number | null; description?: string | null } | undefined;
  const requesterId = ticketPayload?.requester_id ?? null;

  // The ticket's own opening message (its `description`), derived from the
  // ticket snapshot rather than a comment. Never sourced from a synthesized
  // comment or written back; purely a display-time read of data
  // `mapTicketToRawEvent` already persisted.
  let initialMessage: ConversationMessage | null = null;
  const caseCreatedEvent = events.find((event) => event.type === "case_created");
  const description = ticketPayload?.description?.trim();
  // 3.7: shown for every actor, including "system" (a trigger/automation/rule
  // created the ticket) — a neutral, centered bubble rather than a
  // Customer/Agent one (see ConversationMessageBubble).
  if (description && caseCreatedEvent) {
    const actor = caseCreatedEvent.actor;
    initialMessage = {
      // Namespaced off the case_created event's own id (a cuid, unique per
      // case) — never a raw Zendesk comment/audit event id, so this can never
      // collide with a real agent_replied/customer_replied message.
      id: `${caseCreatedEvent.id}:description`,
      occurredAt: caseCreatedEvent.occurredAt,
      actor,
      type: actor === "agent" ? "agent_replied" : actor === "customer" ? "customer_replied" : "case_created",
      authorName: actor === "customer" ? caseRow.requesterName : null,
      isRequester: actor === "customer" ? true : undefined,
      body: description,
    };
  }

  if (replyEvents.length === 0) return initialMessage ? [initialMessage] : [];

  // Group replies by the audit they came from, in each audit's own
  // sourceSequence order — the order `deriveNormalizedEventsForTicket` walked
  // that audit's events in.
  const groups = new Map<string, ReplyEvent[]>();
  for (const event of replyEvents) {
    const group = groups.get(event.sourceRawEventId);
    if (group) group.push(event);
    else groups.set(event.sourceRawEventId, [event]);
  }

  const bodyByEventId = new Map<string, ZendeskCommentBody>();
  // Explicit dedupe by the audit's own id + the comment's own id within it
  // (3.7/C-5) — a globally stable key (unlike `sourceRawEventId`, which names a
  // RawEvent snapshot, not the underlying Zendesk audit) — on top of, not
  // instead of, normalization's own uniqueness: guards display against ever
  // double-rendering the same underlying comment even if two NormalizedEvent
  // rows, or two RawEvent snapshots, somehow both point at it.
  const seenComments = new Set<string>();
  for (const [rawEventId, group] of groups) {
    const audit = payloads.get(rawEventId) as ZendeskAudit | undefined;
    if (!audit) continue;
    const comments = publicCommentBodiesInAudit(audit);
    const ordered = [...group].sort((a, b) => (a.sourceSequence ?? 0) - (b.sourceSequence ?? 0));
    // An audit almost always carries exactly one public comment; when it
    // carries more, both lists were built by walking that audit's events in
    // the same order, so pairing them index-wise recovers the right text for
    // each. A length mismatch (e.g. a comment on the ticket's own creation
    // audit, excluded from `agent_replied`/`customer_replied` but not from
    // this raw scan) pairs as far as the shorter list goes, rather than
    // guessing or throwing.
    ordered.forEach((event, index) => {
      const comment = comments[index];
      if (!comment) return;
      const dedupeKey = `${audit.id}:${comment.id}`;
      if (seenComments.has(dedupeKey)) return;
      seenComments.add(dedupeKey);
      bodyByEventId.set(event.id, comment);
    });
  }

  const messages: ConversationMessage[] = [];
  for (const event of replyEvents) {
    const comment = bodyByEventId.get(event.id);
    if (!comment) continue;
    const isRequester = event.actor === "customer" && comment.authorId != null && comment.authorId === requesterId;
    messages.push({
      id: event.id,
      occurredAt: event.occurredAt,
      actor: event.actor,
      type: event.type,
      authorName: isRequester ? caseRow.requesterName : null,
      isRequester: isRequester ? true : undefined,
      body: comment.body,
    });
  }

  return initialMessage ? [initialMessage, ...messages] : messages;
}
