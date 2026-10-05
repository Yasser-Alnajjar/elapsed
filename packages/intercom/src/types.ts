/**
 * Minimal shapes for the Intercom REST API fields this adapter actually
 * reads. Not full API coverage — extend as real customer usage demands more
 * (roadmap step 22 is a NICE TO HAVE, built only as far as customers who
 * actually ask for Intercom need).
 */

export interface IntercomCredentials {
  accessToken: string;
  tokenType?: string;
  /**
   * Set when a request is rejected with 401. Intercom access tokens don't
   * expire and carry no refresh token (unlike Zendesk/Jira) — a 401 is
   * unambiguous: the token was revoked and there is no path back except the
   * user reconnecting. Cleared automatically on reconnect.
   */
  reauthRequired?: boolean;
  /**
   * The workspace's app id (`app.id_code` from `GET /me`), e.g. "v9jrtlg9".
   * Recorded by the backfill the first time it's missing — the only piece
   * needed to build an inbox link back to a conversation.
   */
  workspaceId?: string;
}

/** One entry in `conversation.contacts.contacts` — the conversation's participants, not full Contact records. */
export interface IntercomConversationContactRef {
  id: string;
  type: string;
}

export interface IntercomConversationSource {
  type: string;
  subject?: string | null;
  /** The opening message, as HTML. */
  body?: string | null;
  author?: { type: string; id: string; name?: string; email?: string };
}

/**
 * Intercom's three-state conversation lifecycle — a flatter vocabulary than
 * Zendesk's six ticket statuses. `normalizeIntercomState` in ./normalize maps
 * this onto the shared `NormalizedState` vocabulary.
 */
export type IntercomConversationState = "open" | "closed" | "snoozed";

/**
 * A second, independent axis that exists only on Intercom *tickets*: the
 * ticket's own lifecycle, shown in the inbox as "Submitted / In progress /
 * Waiting on customer / Resolved" (custom state labels all belong to one of
 * these four categories). Changing it never changes `conversation.state` — a
 * ticket "Waiting on customer" is still an `open` conversation — so
 * `waiting_on_customer` is invisible to `IntercomConversationState`.
 */
export type IntercomTicketState = "submitted" | "in_progress" | "waiting_on_customer" | "resolved";

export interface IntercomConversation {
  id: string;
  created_at: number; // epoch seconds
  updated_at: number;
  state: IntercomConversationState;
  priority?: string | null;
  /** Resolved against the workspace's admin list (`IntercomAdmin`, fetched separately) to `Case.assigneeName` — see `buildIntercomBatch`. */
  admin_assignee_id?: number | string | null;
  contacts?: { contacts: IntercomConversationContactRef[] };
  source?: IntercomConversationSource;
  title?: string | null;
  /**
   * Present when the conversation is an Intercom ticket. Read: the title
   * attribute, `id` (the ticket-API id) and `state` (the ticket's current
   * `IntercomTicketState`, as a string so an unknown future value never
   * breaks a read).
   */
  ticket?: {
    id?: string | number;
    state?: string | null;
    custom_attributes?: { _default_title_?: { value?: string | null } };
  } | null;
  /** Flat attributes (distinct from `ticket.custom_attributes`): `Ticket category`, `jira_issue_key`. Read by ./tracker and ./correlate. */
  custom_attributes?: Record<string, unknown> | null;
  /** The other side of Intercom's conversation <-> ticket links; see ./tracker. */
  linked_objects?: { data?: IntercomLinkedObject[] | null } | null;
  [key: string]: unknown;
}

/** One `linked_objects.data` entry: `category` is `"Tracker"` on a conversation's reference to a Tracker ticket, `null` on a tracker's reference back. */
export interface IntercomLinkedObject {
  id: string | number;
  type: string;
  category?: string | null;
}

/**
 * One entry in `conversation.conversation_parts.conversation_parts`.
 * `part_type` has a wide vendor vocabulary (comment, note, assignment,
 * language_detection_details, conversation_rating_changed, ...) — only
 * "close", "open", and "snoozed" are read as state transitions; everything
 * else is ignored rather than treated as an error, since Intercom documents
 * no closed set of part types the way Zendesk documents ticket statuses.
 */
export interface IntercomConversationPart {
  id: string;
  part_type: string;
  created_at: number;
  /** HTML; null for parts that carry no message (assignments, state changes, ...). */
  body?: string | null;
  author?: { type: string; id: string; name?: string };
  [key: string]: unknown;
}

/**
 * `part_type` of the conversation parts that record a ticket-state change
 * (`ticket_state_updated_by_admin`, and the workflow/bot equivalents). The
 * part in `GET /conversations/{id}` names no state, only that one changed —
 * see `IntercomTicketPart`.
 */
export const INTERCOM_TICKET_STATE_PART_TYPE_PREFIX = "ticket_state_updated";

/**
 * One entry in `GET /tickets/{id}`'s `ticket_parts`. Same ids and timestamps
 * as the conversation's own parts, but a ticket-state change also names the
 * state it left and entered (`previous_ticket_state` → `ticket_state`) — the
 * only place Intercom exposes that history. Parts that don't change the
 * state (comments, notes, assignments) carry neither field.
 */
export interface IntercomTicketPart {
  id: string;
  part_type: string;
  created_at: number;
  previous_ticket_state?: string | null;
  ticket_state?: string | null;
  author?: { type: string; id: string };
  [key: string]: unknown;
}

/** `GET /tickets/{id}` — only the part list is read. */
export interface IntercomTicket {
  id: string;
  ticket_state?: string | null;
  ticket_parts?: { ticket_parts: IntercomTicketPart[] } | null;
  [key: string]: unknown;
}

/** `GET /me` — only the workspace identifier is read. */
export interface IntercomMe {
  app?: { id_code?: string } | null;
}

/** `GET /conversations/{id}` — the only endpoint that returns the full part list. */
export interface IntercomConversationWithParts extends IntercomConversation {
  conversation_parts?: { conversation_parts: IntercomConversationPart[]; total_count: number };
}

export interface IntercomConversationSearchPage {
  conversations: IntercomConversation[];
  pages: { next?: { starting_after: string } | null; total_pages: number };
  total_count: number;
}

export interface IntercomCompany {
  id: string;
  name: string;
  updated_at: number;
  [key: string]: unknown;
}

export interface IntercomCompaniesPage {
  data: IntercomCompany[];
  pages: { page: number; per_page: number; total_pages: number };
  total_count: number;
}

/** Only the fields the normalizer needs to resolve a conversation's primary contact to a company. */
export interface IntercomContact {
  id: string;
  name?: string | null;
  email?: string | null;
  companies?: { data: { id: string }[] };
  [key: string]: unknown;
}

/** A workspace teammate — read only to resolve `conversation.admin_assignee_id` to a display name (D10/3.6). */
export interface IntercomAdmin {
  id: string;
  name?: string | null;
  [key: string]: unknown;
}

export interface IntercomAdminsPage {
  type: "admin.list";
  admins: IntercomAdmin[];
}

/**
 * Persisted in Integration.cursor. Resumable across backfill runs, mirroring
 * ZendeskCursor: `updatedSince` is the incremental-search watermark, advanced
 * only after a page's conversations (and their parts/contacts) have been
 * written as RawEvents.
 */
export interface IntercomCursor {
  conversations?: { updatedSince: number; startingAfter?: string };
  backfillCompletedAt?: string; // ISO 8601
}
