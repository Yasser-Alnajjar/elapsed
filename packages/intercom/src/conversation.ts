import type { ConversationInput, ConversationMessage } from "@sla/ingestion";
import { extractIntercomMessageBody } from "./normalize";
import type { IntercomConversationPart } from "./types";

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

/**
 * The case's public conversation: every `agent_replied`/`customer_replied`
 * event paired with the text of the conversation part it was derived from.
 * Each such event's raw event is one Intercom part. Notes and transitions
 * never became events, so they never appear here.
 */
export function renderIntercomConversation({ events, payloads }: ConversationInput): ConversationMessage[] {
  // Explicit dedupe by source part id (3.7/C-5), on top of — not instead of —
  // normalization's own uniqueness (each RawEvent is one Intercom part).
  const seenParts = new Set<string>();
  return events.flatMap((event): ConversationMessage[] => {
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
}
