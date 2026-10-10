import type { ConversationInput, ConversationMessage } from "@sla/ingestion";
import { evaluateDate, evaluateText, stripHtml, type EvalEnv } from "./transforms";
import { evaluatePath } from "./path";
import { parseConfig, type CustomConfig } from "./schema";

const MAX_BODY = 5000;

/**
 * The case's public conversation for a `custom` source, read at render time
 * from the stored raw events and the integration's active configuration
 * (plan 09, section 7, option B): the configured body and author paths are
 * applied here, so nothing is frozen into the stored payloads and replay is
 * preserved. A body is stripped to plain text; the view never interprets markup.
 *
 * If no body path is mapped, no message text was stored and the Conversation
 * shows event rows without bodies. Display only: it never alters events.
 */
export function renderCustomConversation(input: ConversationInput): ConversationMessage[] {
  const parsed = input.config === undefined ? null : parseConfig(input.config);
  if (!parsed || !parsed.ok) return [];
  const config = parsed.config;
  const mapping = config.commentMapping;
  if (!mapping) return [];
  const env: EvalEnv = { timezone: config.timezone ?? null };

  // Embedded comments live in the ticket snapshot that sourced the reply events; separate ones are their own raw events.
  const embedded = !config.comments?.request;
  const used = new Set<string>();
  const messages: ConversationMessage[] = [];
  for (const event of input.events) {
    if (event.type !== "agent_replied" && event.type !== "customer_replied") continue;
    const payload = input.payloads.get(event.sourceRawEventId);
    if (payload === undefined) continue;
    const candidates = embedded ? embeddedComments(config, payload) : separateComment(payload);
    const match = candidates.find((doc, index) => {
      const key = `${event.sourceRawEventId}#${index}`;
      if (used.has(key)) return false;
      try {
        const at = evaluateDate(mapping.createdAt, doc, env);
        if (at === null || at.toISOString() !== new Date(event.occurredAt).toISOString()) return false;
        used.add(key);
        return true;
      } catch {
        return false;
      }
    });
    if (!match) continue;
    let body = "";
    let authorName: string | null = null;
    try {
      body = mapping.body ? (evaluateText({ transform: "stripHtml", of: mapping.body }, match, env) ?? "") : "";
      authorName = mapping.authorName ? evaluateText(mapping.authorName, match, env) : null;
    } catch {
      continue;
    }
    messages.push({
      id: event.id,
      occurredAt: event.occurredAt,
      actor: event.actor,
      type: event.type,
      authorName: authorName?.slice(0, 120) ?? (event.actor === "customer" ? input.case.requesterName : null),
      body: body.slice(0, MAX_BODY),
    });
  }
  return messages;
}

function embeddedComments(config: CustomConfig, ticketPayload: unknown): unknown[] {
  if (!config.comments) return [];
  return evaluatePath(config.comments.itemsPath, ticketPayload).flatMap((match) => (Array.isArray(match) ? match : [match]));
}

/** A separately fetched comment is stored as `{ t: ticketId, i: projection }`. */
function separateComment(payload: unknown): unknown[] {
  return payload !== null && typeof payload === "object" && "i" in payload ? [(payload as { i: unknown }).i] : [];
}
