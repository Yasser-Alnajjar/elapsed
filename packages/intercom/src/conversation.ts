import type { ConversationInput, ConversationMessage } from "@sla/ingestion";
import { extractIntercomMessageBody } from "./normalize";
import type { IntercomConversation, IntercomConversationPart } from "./types";

/**
 * Intercom message bodies are HTML. This strips markup down to plain text
 * for display — the conversation view never uses `dangerouslySetInnerHTML`,
 * so third-party HTML is never interpreted as markup.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `providerEventId` prefix of the conversation's snapshots, the raw events `renderIntercomConversation` reads for the opening message. */
export const intercomConversationContext = (externalId: string): string[] => [`conversation:${externalId}:`];

/**
 * The case's public conversation: every `agent_replied`/`customer_replied`
 * event paired with the text of the conversation part it was derived from.
 * Each such event's raw event is one Intercom part. Notes and transitions
 * never became events, so they never appear here.
 *
 * Prepended with the conversation's own opening message (`source.body`), which
 * Intercom does not repeat as a part. Like Zendesk's ticket description, this
 * is display only: it never becomes an `agent_replied`/`customer_replied`
 * event, so it cannot reach first-response or next-reply math.
 */
export function renderIntercomConversation({ case: caseRow, events, payloads, context }: ConversationInput): ConversationMessage[] {
  const opening = openingMessage(caseRow, events, context[0] as IntercomConversation | undefined);

  // Explicit dedupe by source part id (3.7/C-5), on top of — not instead of —
  // normalization's own uniqueness (each RawEvent is one Intercom part).
  const seenParts = new Set<string>();
  const replies = events.flatMap((event): ConversationMessage[] => {
    if (event.type !== "agent_replied" && event.type !== "customer_replied") return [];
    if (seenParts.has(event.sourceRawEventId)) return [];
    const part = payloads.get(event.sourceRawEventId) as IntercomConversationPart | undefined;
    if (!part) return [];
    const message = extractIntercomMessageBody(part);
    if (!message) return [];
    seenParts.add(event.sourceRawEventId);
    return [
      {
        id: event.id,
        occurredAt: event.occurredAt,
        actor: event.actor,
        type: event.type,
        authorName: message.authorName,
        body: htmlToPlainText(message.bodyHtml),
      },
    ];
  });
  return opening ? [opening, ...replies] : replies;
}

/**
 * The conversation's first message, from its snapshot's `source`. Needs the
 * `case_created` event (for its id, time and actor) and a non-empty body; an
 * empty or missing one shows nothing rather than a blank bubble.
 */
function openingMessage(
  caseRow: ConversationInput["case"],
  events: ConversationInput["events"],
  conversation: IntercomConversation | undefined,
): ConversationMessage | null {
  const source = conversation?.source;
  const caseCreated = events.find((event) => event.type === "case_created");
  const body = source?.body ? htmlToPlainText(source.body) : "";
  if (!caseCreated || body === "") return null;
  const actor = caseCreated.actor;
  return {
    // Namespaced off the case_created event's own id, so it can never collide with a part-derived message.
    id: `${caseCreated.id}:opening`,
    occurredAt: caseCreated.occurredAt,
    actor,
    type: actor === "agent" ? "agent_replied" : actor === "customer" ? "customer_replied" : "case_created",
    authorName: source?.author?.name?.trim() || (actor === "customer" ? caseRow.requesterName : null),
    body,
  };
}
