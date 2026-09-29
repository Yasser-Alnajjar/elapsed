/**
 * Minimal shapes for the Zendesk REST API fields this adapter actually reads.
 * Not full API coverage — extend as the normalizer (roadmap step 3) needs
 * more fields.
 */

export interface ZendeskCredentials {
  subdomain: string;
  accessToken: string;
  /** Absent for integrations connected before refresh support, or if the Zendesk OAuth client has no refresh token configured. */
  refreshToken?: string;
  tokenType: string;
  scope: string;
  /** Epoch ms. Absent means the access token does not expire (legacy client, or token expiration disabled on the Zendesk OAuth client). */
  expiresAt?: number;
  /** Epoch ms. Absent means unknown. */
  refreshTokenExpiresAt?: number;
  /** Set when a refresh attempt fails because the refresh token itself is invalid/expired/revoked. Cleared automatically on reconnect. */
  reauthRequired?: boolean;
}

export interface ZendeskTicket {
  id: number;
  url: string;
  external_id: string | null;
  subject: string | null;
  created_at: string;
  updated_at: string;
  status: string;
  priority: string | null;
  organization_id: number | null;
  requester_id?: number | null;
  /** Who created the ticket (an agent can submit on a customer's behalf, so this can differ from `requester_id`). Used only as the fallback creator when the creation audit isn't available yet. */
  submitter_id?: number | null;
  /** Ticket tags, used as a generic SLA policy match input (`match.conditions`, field `"tags"`/`"current_tags"` — see `extractMatchFromFilter` in ./policies). Absent on very old snapshots fetched before this field was read. */
  tags?: string[];
  via?: { channel: string };
  /**
   * Not a real Zendesk API field — resolved from the `users` sideload
   * (`include=users`) and embedded onto the ticket snapshot before it's
   * persisted as a RawEvent (see `mapTicketToRawEvent`), so the normalizer
   * can read the requester's display name straight off the ticket without a
   * separate RawEvent stream. Null when the ticket has no requester or the
   * requester wasn't present in the sideload.
   */
  requester_name?: string | null;
  /** Zendesk's ticket type ("problem"/"incident"/"question"/"task") — a generic SLA policy match input, field `"type"`. Null for an untyped ticket. */
  type?: string | null;
  /** The agent group currently assigned, if any — generic SLA policy match input, field `"group_id"`. */
  group_id?: number | null;
  /** The individual agent currently assigned, if any — generic SLA policy match input, field `"assignee_id"`. */
  assignee_id?: number | null;
  /**
   * Not a real Zendesk API field — resolved from the same `users` sideload as
   * `requester_name` and embedded before persistence (see `mapTicketToRawEvent`).
   * Display only (D10/3.6): never used for matching, correlation, or routing.
   * Null when the ticket has no assignee or the assignee wasn't present in
   * the sideload.
   */
  assignee_name?: string | null;
  /** The brand this ticket was submitted through (multi-brand accounts) — generic SLA policy match input, field `"brand_id"`. */
  brand_id?: number | null;
  /** The ticket form used to submit this ticket — generic SLA policy match input, field `"ticket_form_id"` (Zendesk also accepts the alias `"form_id"`). */
  ticket_form_id?: number | null;
  /** The email address (or channel-specific address) the ticket was submitted to — generic SLA policy match input, field `"recipient"`. */
  recipient?: string | null;
  /** Custom ticket field values — each becomes a generic SLA policy match input under field `"custom_fields_<id>"` (see `zendeskConditionAttributes` in ./normalize). */
  custom_fields?: { id: number; value: unknown }[];
  [key: string]: unknown;
}

export interface ZendeskIncrementalTicketExport {
  tickets: ZendeskTicket[];
  end_time: number;
  next_page: string | null;
  count: number;
  /** Sideloaded via `include=users` (see `ZendeskClient.fetchTicketsPage`): every user referenced by a ticket in this page (requesters, assignees, ...), deduplicated by Zendesk. */
  users?: ZendeskUser[];
}

/**
 * One entry in an audit's `events` array. Zendesk emits many event `type`s
 * (Comment, Notification, Rating, …) — the normalizer only reads `Change`
 * events on the `status` field and public `Comment` events.
 */
export interface ZendeskAuditEvent {
  id: number;
  type: string;
  field_name?: string;
  value?: unknown;
  previous_value?: unknown;
  [key: string]: unknown;
}

export interface ZendeskAudit {
  id: number;
  ticket_id: number;
  created_at: string;
  author_id: number;
  via?: { channel: string };
  events: ZendeskAuditEvent[];
  [key: string]: unknown;
}

/**
 * A Zendesk user's account role — what actually tells an agent's comment
 * from a customer's. Ticket relationships (requester, assignee) don't: an
 * agent can be a ticket's requester.
 */
export type ZendeskUserRole = "end-user" | "agent" | "admin";

export interface ZendeskUser {
  id: number;
  role: ZendeskUserRole;
  /** Present on the `users` sideload (`include=users`); not read from the audits sideload, which only ever asks for `role` (see `mapUserToRawEvent`'s privacy-minimization comment). */
  name?: string;
  [key: string]: unknown;
}

export interface ZendeskAuditsPage {
  audits: ZendeskAudit[];
  /** Sideloaded via `include=users` (see `ZendeskClient.fetchTicketAuditsPage`): the audits' authors, with their roles. */
  users?: ZendeskUser[];
  next_page: string | null;
}

export interface ZendeskTicketShow {
  ticket: ZendeskTicket;
  /** Sideloaded via `include=users` (see `ZendeskClient.fetchTicket`): every user referenced by this ticket (requester, assignee, ...). */
  users?: ZendeskUser[];
}

export interface ZendeskOrganization {
  id: number;
  name: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface ZendeskIncrementalOrganizationExport {
  organizations: ZendeskOrganization[];
  end_time: number;
  next_page: string | null;
  count: number;
}

/**
 * One condition in an SLA policy's `filter`. `field` covers Zendesk's full
 * condition vocabulary — the importer (`extractMatchFromFilter` in
 * ./policies) preserves every field/operator generically, exactly as
 * Zendesk sent it, never dropping or rewriting one it doesn't recognize.
 *
 * A condition only ever *matches*, though, when the case's attributes
 * actually carry that field — see `zendeskConditionAttributes` (./normalize)
 * and `toCaseAttributes` (packages/commitments) for the full Zendesk field ->
 * Case/Case.attributes mapping this importer resolves:
 *
 *   priority          -> Case.priority            -> attributes.priority
 *   tags              -> Case.tags                -> attributes.tags, attributes.current_tags
 *   organization_id    -> Case.customerId          -> match.customerIds (never a generic attribute — see extractMatchFromFilter)
 *   status            -> attributes (raw Zendesk status, e.g. "pending") -> attributes.status
 *   type              -> attributes.type           -> attributes.type
 *   group_id          -> attributes.group_id       -> attributes.group_id
 *   assignee_id       -> attributes.assignee_id    -> attributes.assignee_id
 *   requester_id      -> attributes.requester_id   -> attributes.requester_id
 *   via_id/current_via_id -> ticket.via.channel (string) -> attributes.channel, attributes.via_id, attributes.current_via_id
 *   brand_id          -> attributes.brand_id       -> attributes.brand_id
 *   ticket_form_id    -> attributes.ticket_form_id -> attributes.ticket_form_id, attributes.form_id
 *   recipient         -> attributes.recipient      -> attributes.recipient
 *   exact_created_at  -> ticket.created_at         -> attributes.exact_created_at (compared with less_than/greater_than)
 *   custom_fields_N   -> ticket.custom_fields[]    -> attributes["custom_fields_N"]
 *
 * A field with no row above (Zendesk's custom ticket types/`ticket_type_id`,
 * custom ticket statuses/`custom_status_id`, `satisfaction_score`,
 * `locale_id`, `user.custom_fields.*`/`organization.custom_fields.*`) is not
 * resolved by this importer — this integration doesn't ingest the
 * corresponding Zendesk registries (ticket types, custom statuses,
 * satisfaction ratings, requester/org custom fields), so a policy
 * conditioned on one of them fails safe (never matches) rather than being
 * silently guessed at. `via_id`/`current_via_id` is matched against
 * Zendesk's `via.channel` *string* (e.g. `"chat"`, `"web"`, `"api"`) since
 * that's what the Ticket API actually gives us; a condition whose `value` is
 * Zendesk's internal numeric via id (undocumented in a way this importer
 * could verify) will likewise fail safe rather than risk a wrong mapping.
 */
export interface ZendeskSlaPolicyCondition {
  field: string;
  operator: string;
  value: string | number | null;
}

export interface ZendeskSlaPolicyFilter {
  all?: ZendeskSlaPolicyCondition[];
  any?: ZendeskSlaPolicyCondition[];
}

/**
 * One (priority, metric) target row. Zendesk lets a single policy define
 * different targets per ticket priority — `priority: null` means the target
 * applies regardless of priority. `metric` is Zendesk's full metric
 * vocabulary (first_reply_time, next_reply_time, requester_wait_time,
 * agent_work_time, periodic_update_time, total_resolution_time); only
 * `first_reply_time`/`total_resolution_time`/`next_reply_time` map to a
 * `CommitmentKind` we track (see `METRIC_TO_COMMITMENT_KIND` in ./policies).
 */
export interface ZendeskSlaPolicyMetric {
  priority: string | null;
  metric: string;
  target: number; // minutes
  business_hours: boolean;
}

export interface ZendeskSlaPolicy {
  id: number;
  title: string;
  filter?: ZendeskSlaPolicyFilter;
  policy_metrics?: ZendeskSlaPolicyMetric[];
  /**
   * The business hours schedule this policy's `business_hours` metrics are
   * measured against (Zendesk's Multiple Schedules feature). Null/absent
   * means the account's metrics run on calendar time, or on a single
   * account-wide schedule that isn't independently selectable per policy —
   * either way there's no specific schedule to import a calendar for.
   */
  schedule_id?: number | null;
  /**
   * Zendesk's own evaluation order for this policy relative to every other
   * policy on the account — lower matches first (D6). Absent on very old
   * accounts/snapshots fetched before this field was read; `position` on the
   * imported `SLAPolicy` is then left `null` and falls back to specificity
   * (`matchPolicyVersion`, packages/core).
   */
  position?: number;
  [key: string]: unknown;
}

export interface ZendeskSlaPoliciesPage {
  sla_policies: ZendeskSlaPolicy[];
  next_page: string | null;
}

/**
 * One row from Zendesk's official Jira-links registry (`GET
 * /api/v2/jira/links`) — the structured Zendesk↔Jira relationship the
 * official Zendesk Jira integration itself maintains. Unlike a Jira remote
 * link (`JiraRemoteLink` in packages/jira/src/types.ts), Zendesk hands back
 * the ticket id and Jira issue key directly: no URL to parse, no hostname to
 * validate. That's what makes this the authoritative correlation signal (see
 * packages/zendesk/src/correlate.ts) — it still finds the relationship when a
 * Jira remote link exists but carries a stale Zendesk subdomain.
 *
 * `ticket_id` is a **string** in the live response (confirmed against a real
 * connected account, roadmap regression fix) despite the name suggesting a
 * number — `parseJiraLinkRecord` (./correlate.ts) accounts for this.
 */
export interface ZendeskJiraLink {
  id: number;
  ticket_id: string;
  issue_key: string;
  issue_id?: string;
  [key: string]: unknown;
}

/**
 * Confirmed against the live endpoint: there is no `next_page` URL here,
 * unlike every other paginated Zendesk endpoint this adapter reads. Instead
 * it follows Zendesk's documented cursor-pagination envelope
 * (developer.zendesk.com/api-reference/introduction/pagination/#cursor-pagination):
 * `meta.has_more` says whether another page exists, and (when true)
 * `meta.after_cursor` is passed back as the `page[after]` query param to
 * fetch it. `total` is informational only — not used for pagination.
 */
export interface ZendeskJiraLinksPage {
  links: ZendeskJiraLink[];
  total?: number;
  meta?: { has_more: boolean; after_cursor?: string | null };
}

/**
 * One open window, expressed as minutes since Sunday 00:00 in the
 * schedule's own timezone — a flat weekly offset rather than a per-day
 * (day, openMinute, closeMinute) triple. Assumed to fall within a single
 * day; Zendesk does not emit an interval spanning midnight.
 */
export interface ZendeskBusinessHoursInterval {
  start_time: number;
  end_time: number;
}

export interface ZendeskBusinessHoursSchedule {
  id: number;
  name: string;
  time_zone: string;
  intervals: ZendeskBusinessHoursInterval[];
  [key: string]: unknown;
}

export interface ZendeskBusinessHoursSchedulesPage {
  schedules: ZendeskBusinessHoursSchedule[];
}

/** `start_date`/`end_date` are "YYYY-MM-DD", inclusive of both endpoints. */
export interface ZendeskScheduleHoliday {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
}

export interface ZendeskScheduleHolidaysPage {
  holidays: ZendeskScheduleHoliday[];
  next_page: string | null;
}

/**
 * Persisted in Integration.cursor. Resumable across backfill runs: each
 * `startTime` is the Zendesk incremental-export watermark for that stream,
 * advanced only after a page's tickets/organizations (and, for tickets,
 * their audits) have been written as RawEvents.
 */
export interface ZendeskCursor {
  tickets?: { startTime: number };
  organizations?: { startTime: number };
  backfillCompletedAt?: string; // ISO 8601
}
