import type { IntercomConversation } from "./types";

/**
 * Intercom Tracker tickets: the shared, internal ticket a team opens from one
 * or more customer conversations to escalate a widespread issue, which the
 * Jira integration then links to a single Jira issue. A tracker has no
 * contact and no customer-facing messages, so it is not a Case. It is the
 * link between customer conversations and an engineering issue, the same role
 * Zendesk's official Jira-link record plays (`correlateIntercomJiraKeys`
 * turns it into `CaseLink`s on the conversations it is linked from).
 *
 * Two signals, neither a guess:
 *  - a conversation's `linked_objects` names it, as `{ type: "ticket", category: "Tracker" }`;
 *  - its own built-in `Ticket category` attribute reads `Tracker ticket`.
 * Customer tickets (`Customer ticket`) and conversations are never trackers.
 */
export const INTERCOM_TRACKER_CATEGORY = "Tracker";
export const INTERCOM_TRACKER_TICKET_CATEGORY = "Tracker ticket";
export const INTERCOM_TICKET_CATEGORY_ATTRIBUTE = "Ticket category";

/** A conversation that identifies itself as a Tracker ticket. */
export function isIntercomTrackerTicket(conversation: Pick<IntercomConversation, "custom_attributes">): boolean {
  return conversation.custom_attributes?.[INTERCOM_TICKET_CATEGORY_ATTRIBUTE] === INTERCOM_TRACKER_TICKET_CATEGORY;
}

/** The Tracker tickets this conversation is linked to (from its own `linked_objects`). */
export function linkedTrackerIds(conversation: Pick<IntercomConversation, "linked_objects">): string[] {
  const data = conversation.linked_objects?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((link) => link?.type === "ticket" && link.category === INTERCOM_TRACKER_CATEGORY && link.id != null)
    .map((link) => String(link.id));
}
