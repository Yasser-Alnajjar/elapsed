import { Prisma, type PrismaClient } from "@sla/db";
import type { Actor, CanonicalPriority, NormalizedEventType, NormalizedState } from "@sla/core";
import type { ZendeskAudit, ZendeskOrganization, ZendeskTicket, ZendeskUser, ZendeskUserRole } from "./types";
import type { CanonicalBatch, CaseFacts, CustomerIdentityFact, EventGroup, ProjectionFailure } from "@sla/ingestion";
import { zendeskOrganizationIdentity } from "./customer-identity";
import { ZENDESK_SOURCE_ROLE } from "./source-role";

/** Zendesk's closed set of ticket statuses, mapped to the provider-independent vocabulary. */
const STATUS_TO_NORMALIZED_STATE: Record<string, NormalizedState> = {
  new: "new",
  open: "open",
  pending: "pending_customer",
  hold: "pending_internal",
  solved: "resolved",
  closed: "closed",
};

export class UnknownZendeskStatusError extends Error {
  constructor(status: string) {
    super(`Unknown Zendesk ticket status: ${status}`);
    this.name = "UnknownZendeskStatusError";
  }
}

export function normalizeZendeskStatus(status: string): NormalizedState {
  const mapped = STATUS_TO_NORMALIZED_STATE[status];
  if (!mapped) throw new UnknownZendeskStatusError(status);
  return mapped;
}

/** Channels Zendesk uses when a trigger/automation/rule made the change, not a person. */
const SYSTEM_CHANNELS = new Set(["trigger", "automation", "rule"]);

/** Zendesk user id → role, from the users sideloaded alongside ticket audits. */
export type ZendeskUserRoles = ReadonlyMap<number, ZendeskUserRole>;

const ACTOR_BY_ROLE: Record<ZendeskUserRole, Actor> = {
  "end-user": "customer",
  agent: "agent",
  admin: "agent",
};

function actorForKnownRole(authorId: number, userRoles: ZendeskUserRoles): Actor | undefined {
  const role = userRoles.get(authorId);
  return role ? ACTOR_BY_ROLE[role] : undefined;
}

/**
 * A system channel wins outright. Otherwise the author's Zendesk role
 * decides: agents and admins are "agent", end users are "customer" — even
 * when an agent is the ticket's own requester.
 *
 * Only when the author's role hasn't been ingested (audits fetched before
 * users were sideloaded) does this fall back to the older guess: the
 * ticket's requester is the customer, anyone else an agent.
 */
export function resolveActor(
  channel: string | undefined,
  authorId: number,
  ticket: ZendeskTicket,
  userRoles: ZendeskUserRoles = new Map(),
): Actor {
  if (channel && SYSTEM_CHANNELS.has(channel)) return "system";
  const byRole = actorForKnownRole(authorId, userRoles);
  if (byRole) return byRole;
  if (ticket.requester_id != null && authorId === ticket.requester_id) return "customer";
  return "agent";
}

function isStatusChangeEvent(
  event: ZendeskAudit["events"][number],
): event is { id: number; type: "Change"; field_name: "status"; value: string; previous_value: string } {
  return (
    event.type === "Change" &&
    event.field_name === "status" &&
    typeof event.value === "string" &&
    typeof event.previous_value === "string"
  );
}

/**
 * Zendesk's ticket priorities are already Elapsed's vocabulary
 * (`CanonicalPriority`), so this is the identity mapping; a value outside it
 * (not something Zendesk sends) becomes `null` rather than leaking a raw
 * provider string past the adapter.
 */
export function normalizeZendeskPriority(priority: string | null | undefined): CanonicalPriority | null {
  switch (priority) {
    case "low":
    case "normal":
    case "high":
    case "urgent":
      return priority;
    default:
      return null;
  }
}

/** Unlike status, a priority can be unset (`null`) on either side of the change. */
function isPriorityChangeEvent(
  event: ZendeskAudit["events"][number],
): event is { id: number; type: "Change"; field_name: "priority"; value: string | null; previous_value: string | null } {
  return (
    event.type === "Change" &&
    event.field_name === "priority" &&
    (typeof event.value === "string" || event.value === null) &&
    (typeof event.previous_value === "string" || event.previous_value === null)
  );
}

export function isPublicCommentEvent(
  event: ZendeskAudit["events"][number],
): event is { id: number; type: "Comment"; public: true; author_id?: number } {
  return event.type === "Comment" && event.public === true;
}

/** One public comment's text and author, read straight off an audit event — for conversation display only, never for SLA math. */
export interface ZendeskCommentBody {
  /** The comment event's own `id` — unique within its audit, used to dedupe conversation display (3.7/C-5). */
  id: number;
  authorId: number | null;
  body: string;
}

/**
 * Every public Comment event in one audit, in the audit's own event order,
 * with its text extracted (Zendesk's `plain_body`, falling back to `body` —
 * both already plain text, never `html_body`). A Comment event with no
 * usable text (attachment-only, blank) is left out. This reads exactly the
 * same `public: true` events `deriveNormalizedEventsForTicket` turns into
 * `agent_replied`/`customer_replied`, just keeping their content instead of
 * discarding it.
 */
export function publicCommentBodiesInAudit(audit: ZendeskAudit): ZendeskCommentBody[] {
  const results: ZendeskCommentBody[] = [];
  for (const raw of audit.events) {
    // Read the untyped fields before the `isPublicCommentEvent` guard
    // narrows `raw`'s type — its asserted type carries no index signature.
    const plainBody = raw.plain_body;
    const bodyField = raw.body;
    const authorIdField = raw.author_id;
    if (!isPublicCommentEvent(raw)) continue;
    const body = typeof plainBody === "string" ? plainBody : typeof bodyField === "string" ? bodyField : "";
    if (body.trim() === "") continue;
    const authorId = typeof authorIdField === "number" ? authorIdField : audit.author_id;
    results.push({ id: raw.id, authorId: typeof authorId === "number" ? authorId : null, body });
  }
  return results;
}

export interface AuditRecord {
  /** The RawEvent row id this audit was read from — becomes NormalizedEvent.sourceRawEventId. */
  rawEventId: string;
  audit: ZendeskAudit;
}

export interface DerivedNormalizedEvent {
  type: NormalizedEventType;
  occurredAt: string;
  actor: Actor;
  /** A `CanonicalPriority`, not a `NormalizedState`, on `priority_changed` — see `NormalizedEvent` (@sla/core). */
  fromState: NormalizedState | CanonicalPriority | null;
  toState: NormalizedState | CanonicalPriority | null;
  sourceRawEventId: string;
  /**
   * Position in the ticket's own source order: 0 for the synthesized
   * `case_created`, then one slot per audit event in audit order
   * (`sortAuditsChronologically`) and each event's index within its audit.
   * Assigned from the source, never from the normalized output's order.
   */
  sourceSequence: number;
}

export function sortAuditsChronologically(audits: AuditRecord[]): AuditRecord[] {
  return [...audits].sort((a, b) => {
    const byTime = Date.parse(a.audit.created_at) - Date.parse(b.audit.created_at);
    return byTime !== 0 ? byTime : a.audit.id - b.audit.id;
  });
}

/**
 * A ticket's creation audit is stamped with the ticket's own `created_at`
 * (Zendesk writes them in the same instant); allow a little clock slack.
 */
const CREATION_AUDIT_SLACK_MS = 5_000;

/**
 * Who created the ticket (H-11). This must depend only on facts fixed at
 * creation, never on how much audit history has been ingested so far —
 * `case_created.actor` decides where a First Response clock starts (D5b), and
 * that commitment is created once and never re-derived, so an actor that
 * changes as later audits arrive freezes the wrong start. (It used to be the
 * author of the first *status change*, which is the agent who picked the
 * ticket up or solved it, and fell back to the requester before any status
 * change existed.)
 *
 * Order of evidence, each fixed for the life of the ticket:
 * 1. the ticket's `submitter_id` — Zendesk's own record of who created it,
 *    part of the ticket snapshot and identical on every ingest. It is what
 *    Zendesk itself keys the first-reply SLA on: the dev-sandbox H-4 check
 *    found Zendesk applied no first-reply target to agent-submitted tickets
 *    and did apply one to a customer-submitted ticket whose creation audit
 *    was nevertheless authored by an admin (a sample-data artifact), so the
 *    audit author must not outrank it;
 * 2. else the author of the creation audit — the chronologically first audit,
 *    when it carries `Create` events or is stamped at the ticket's `created_at`;
 * 3. else the requester (the oldest fallback: a customer).
 * A later audit is never consulted, so the result is identical for any
 * superset of the audits and for none.
 */
function resolveCreationActor(
  ticket: ZendeskTicket,
  sortedAudits: AuditRecord[],
  userRoles: ZendeskUserRoles,
): Actor {
  if (ticket.submitter_id != null) {
    return resolveActor(ticket.via?.channel, ticket.submitter_id, ticket, userRoles);
  }
  const first = sortedAudits[0]?.audit;
  const isCreationAudit =
    first !== undefined &&
    (first.events.some((event) => event.type === "Create") ||
      Math.abs(Date.parse(first.created_at) - Date.parse(ticket.created_at)) <= CREATION_AUDIT_SLACK_MS);
  if (isCreationAudit) return resolveActor(first.via?.channel, first.author_id, ticket, userRoles);
  return resolveActor(ticket.via?.channel, ticket.requester_id ?? -1, ticket, userRoles);
}

/**
 * `RawEvent` → `NormalizedEvent` for one ticket. Regenerated from scratch on
 * every run (never diffed incrementally) — callers should replace, not
 * append to, a case's existing NormalizedEvents with this output.
 *
 * Status `Change` events carry Zendesk's own before/after values, so the
 * ticket's initial state comes from the first Change event's
 * `previous_value` (falling back to the ticket's current status when no
 * status change was ever recorded) rather than from re-deriving it by
 * replaying transitions ourselves.
 *
 * Public agent comments become `agent_replied` events — what completes a
 * first-response commitment — and public customer comments become
 * `customer_replied`. Private notes and trigger/automation comments become
 * neither. Comments on the ticket's creation audit (the ticket's own
 * description, even when an agent opened it) never count, and neither do
 * comments whose author has no known role on a ticket whose requester is
 * also unknown, since `resolveActor` could not tell the customer's comments
 * from an agent's.
 *
 * Events keep the ticket's true source order: audits chronologically (audit
 * id breaking same-second ties) and, inside an audit, the order Zendesk
 * lists its events in — a comment listed before a status change in the same
 * audit stays before it. `sourceSequence` records that order so it survives
 * persistence (see `compareNormalizedEvents` in @sla/core).
 *
 * A `Change` event on `field_name: "priority"` becomes `priority_changed`
 * (E-14/3.1) — display-only, read by the Activity Timeline, never by SLA
 * matching or the engine (which still reads `Case.priority`, the live
 * snapshot written below).
 */
export function deriveNormalizedEventsForTicket(
  ticket: ZendeskTicket,
  auditsForTicket: AuditRecord[],
  ticketRawEventId: string,
  userRoles: ZendeskUserRoles = new Map(),
): DerivedNormalizedEvent[] {
  const sorted = sortAuditsChronologically(auditsForTicket);
  const statusChanges = sorted.flatMap(({ rawEventId, audit }) =>
    audit.events.filter(isStatusChangeEvent).map((event) => ({ rawEventId, audit, event })),
  );

  const firstChange = statusChanges[0];
  const initialStatus = firstChange ? firstChange.event.previous_value : ticket.status;
  const createdActor = resolveCreationActor(ticket, sorted, userRoles);

  const events: DerivedNormalizedEvent[] = [
    {
      type: "case_created",
      occurredAt: ticket.created_at,
      actor: createdActor,
      fromState: null,
      toState: normalizeZendeskStatus(initialStatus),
      sourceRawEventId: firstChange?.rawEventId ?? ticketRawEventId,
      sourceSequence: 0,
    },
  ];

  const createdAtMs = Date.parse(ticket.created_at);
  let sourceSequence = 0;
  for (const { rawEventId, audit } of sorted) {
    for (const event of audit.events) {
      sourceSequence += 1;

      if (isStatusChangeEvent(event)) {
        const toState = normalizeZendeskStatus(event.value);
        events.push({
          // "solved" and "closed" both end the case's customer-facing lifecycle
          // (Zendesk is the source of truth for that — Jira reaching its own
          // "done" category must never produce this type, see jira/normalize.ts).
          // "solved" can still be reopened by a later transition back to a
          // non-terminal state, which is emitted as a plain state_changed.
          type: toState === "closed" || toState === "resolved" ? "case_closed" : "state_changed",
          occurredAt: audit.created_at,
          actor: resolveActor(audit.via?.channel, audit.author_id, ticket, userRoles),
          fromState: normalizeZendeskStatus(event.previous_value),
          toState,
          sourceRawEventId: rawEventId,
          sourceSequence,
        });
        continue;
      }

      if (isPriorityChangeEvent(event)) {
        events.push({
          type: "priority_changed",
          occurredAt: audit.created_at,
          actor: resolveActor(audit.via?.channel, audit.author_id, ticket, userRoles),
          fromState: normalizeZendeskPriority(event.previous_value),
          toState: normalizeZendeskPriority(event.value),
          sourceRawEventId: rawEventId,
          sourceSequence,
        });
        continue;
      }

      if (!isPublicCommentEvent(event)) continue;
      if (Date.parse(audit.created_at) <= createdAtMs) continue;
      const authorId = event.author_id ?? audit.author_id;
      if (ticket.requester_id == null && !actorForKnownRole(authorId, userRoles)) continue;
      const actor = resolveActor(audit.via?.channel, authorId, ticket, userRoles);
      if (actor === "system") continue;
      events.push({
        type: actor === "agent" ? "agent_replied" : "customer_replied",
        occurredAt: audit.created_at,
        actor,
        fromState: null,
        toState: null,
        sourceRawEventId: rawEventId,
        sourceSequence,
      });
    }
  }

  // Emitted in source order already; the sort only guards the synthesized
  // case_created against an audit timestamped before the ticket itself.
  return events.sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.sourceSequence - b.sourceSequence,
  );
}

/**
 * `Case.closedAt` for a ticket: set once it reaches a terminal Zendesk state
 * ("solved" or "closed"), timestamped from the most recent transition into
 * either — not the first, so a solve-then-reopen-then-resolve cycle reports
 * the final resolution, not the first one. Null whenever the ticket's
 * *current* status isn't terminal, including a solved ticket Zendesk later
 * reopened: `ticket.status` is always the live snapshot, so this naturally
 * flips back without needing to detect the reopen explicitly.
 *
 * Falls back to `ticket.updated_at` when no case_closed event was derived at
 * all — a ticket fetched for the first time already solved/closed, with no
 * audit history recorded for the transition.
 */
export function deriveCaseClosedAt(
  ticket: ZendeskTicket,
  derivedEvents: DerivedNormalizedEvent[],
): Date | null {
  const currentState = normalizeZendeskStatus(ticket.status);
  if (currentState !== "resolved" && currentState !== "closed") return null;

  const closureEvent = [...derivedEvents].reverse().find((event) => event.type === "case_closed");
  return new Date(closureEvent?.occurredAt ?? ticket.updated_at);
}

/** Every custom ticket field value keyed the way an SLA policy condition names it (`"custom_fields_<id>"`). */
function customFieldAttributes(ticket: ZendeskTicket): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of ticket.custom_fields ?? []) {
    if (field?.id == null) continue;
    out[`custom_fields_${field.id}`] = field.value;
  }
  return out;
}

/**
 * Generic Zendesk-derived SLA policy match inputs (`Case.attributes`, a
 * `Json` column) for every Zendesk SLA condition field this importer can
 * resolve from a ticket snapshot that ISN'T already one of Case's canonical
 * columns. Canonical fields (priority, tags, channel — plus customerId/tier,
 * which have no Zendesk ticket source) are set directly on `Case` and merged
 * into the match input separately by `toCaseAttributes`
 * (packages/commitments), so they are deliberately not duplicated here.
 * What IS written here are Zendesk's own field-name aliases of those
 * canonical columns: `current_tags` (of `tags`) and `via_id` /
 * `current_via_id` (of `channel`), which only Zendesk SLA conditions use.
 *
 * See the field -> Case/attributes mapping table on `ZendeskSlaPolicyCondition`
 * (./types) for the full picture, including which condition fields this
 * importer does NOT resolve and why.
 */
export function zendeskConditionAttributes(
  ticket: ZendeskTicket,
): Record<string, unknown> {
  return {
    // Alias of the canonical `Case.tags` column: same value the Case row
    // gets (`ticket.tags ?? []`), so a `current_tags` condition sees exactly
    // what a `tags` condition does.
    current_tags: ticket.tags ?? [],
    // Zendesk's raw ticket status (e.g. "pending", "hold") — distinct from
    // this system's own NormalizedState vocabulary, which an SLA condition
    // imported from Zendesk was never written against.
    ...(ticket.status != null ? { status: ticket.status } : {}),
    ...(ticket.type != null ? { type: ticket.type } : {}),
    ...(ticket.group_id != null ? { group_id: ticket.group_id } : {}),
    ...(ticket.assignee_id != null
      ? { assignee_id: ticket.assignee_id }
      : {}),
    ...(ticket.requester_id != null
      ? { requester_id: ticket.requester_id }
      : {}),
    ...(ticket.brand_id != null ? { brand_id: ticket.brand_id } : {}),
    ...(ticket.ticket_form_id != null
      ? {
          ticket_form_id: ticket.ticket_form_id,
          form_id: ticket.ticket_form_id,
        }
      : {}),
    ...(ticket.recipient != null ? { recipient: ticket.recipient } : {}),
    // via_id/current_via_id: matched against the channel string, not
    // Zendesk's internal numeric via id — see ./types.ts's doc comment on
    // `ZendeskSlaPolicyCondition`.
    ...(ticket.via?.channel != null
      ? { via_id: ticket.via.channel, current_via_id: ticket.via.channel }
      : {}),
    ...(ticket.created_at != null
      ? { exact_created_at: ticket.created_at }
      : {}),
    ...customFieldAttributes(ticket),
  };
}

/**
 * Keeps, per numeric `id` embedded in each row's JSON payload, the row with
 * the latest fetchedAt. `rawEventIds` lists every snapshot row seen for that
 * id (not just the latest), so a regenerate-in-place delete can also clear
 * events an older snapshot sourced.
 */
export function latestSnapshotById<T extends { id: number }>(
  rows: { id: string; payload: unknown; fetchedAt: Date }[],
): Map<number, { rawEventId: string; value: T; fetchedAt: Date; rawEventIds: string[] }> {
  const byId = new Map<number, { rawEventId: string; value: T; fetchedAt: Date; rawEventIds: string[] }>();
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

function groupAuditsByTicketId(
  rows: { id: string; payload: unknown }[],
): Map<number, AuditRecord[]> {
  const byTicketId = new Map<number, AuditRecord[]>();
  for (const row of rows) {
    const audit = row.payload as ZendeskAudit;
    const group = byTicketId.get(audit.ticket_id);
    const record: AuditRecord = { rawEventId: row.id, audit };
    if (group) group.push(record);
    else byTicketId.set(audit.ticket_id, [record]);
  }
  return byTicketId;
}

export interface ZendeskNormalizationScope {
  /**
   * Limits the run to these tickets' own RawEvents — used by the webhook
   * receiver so a single ticket update doesn't re-derive NormalizedEvents
   * for every ticket the integration has ever seen (roadmap task 2.4).
   * Organizations and users still load unscoped: they're small reference
   * tables, not the per-ticket audit history that makes an unscoped run
   * expensive, and a ticket's `organization_id`/comment authors aren't known
   * until the ticket itself is read. Omit for the worker's full-account
   * cycle, which must still see every ticket.
   *
   * A ticket-scoped run never moves the incremental watermark: it isn't a
   * view of the whole integration.
   */
  ticketIds?: number[];
  /**
   * The worker's two speeds (roadmap 7.7 Phase 3). `"full"` (default):
   * re-derive every ticket — the hourly reconciliation sweep, and the
   * backstop for anything the incremental path can't see. `"incremental"`:
   * only re-derive tickets touched by RawEvents newer than
   * `Integration.normalizedThroughFetchedAt` (minus `NORMALIZATION_OVERLAP_MS`),
   * falling back to a full pass on the first run or when the changed rows
   * include a user role snapshot (a role change can alter the actor of any
   * past comment, and rows for it are rare).
   *
   * Trade-off: a ticket whose derivation *fails* is retried on the next
   * incremental poll only while it stays inside the overlap window; after
   * that it waits for the next full pass. The failure is reported in
   * `ticketsFailed` either way.
   */
  mode?: "full" | "incremental";
}

/**
 * RawEvents are insert-only, but a webhook delivery and a backfill page can
 * commit their inserts out of `fetchedAt` order (fetchedAt is assigned at
 * insert, not commit), so a row can become visible *behind* the watermark.
 * Each incremental pass re-reads this far back before the watermark; the
 * reprocessing is idempotent (per-ticket derivation only writes a diff), so
 * a re-read row costs a comparison, never a duplicate.
 */
export const NORMALIZATION_OVERLAP_MS = 10 * 60 * 1000;

/** Tickets are derived in batches of this many, keeping each `OR` filter short. */
const TICKET_BATCH_SIZE = 100;

/** The greatest `(fetchedAt, id)` among an integration's RawEvents, or null when it has none. */
async function readHighWaterMark(prisma: PrismaClient, integrationId: string) {
  return prisma.rawEvent.findFirst({
    where: { integrationId },
    orderBy: [{ fetchedAt: "desc" }, { id: "desc" }],
    select: { fetchedAt: true, id: true },
  });
}

/**
 * Ticket ids whose derived state can have changed because of RawEvents newer
 * than `since`: tickets with a new snapshot, tickets with a new audit, and
 * tickets belonging to an organization whose snapshot changed (so the case's
 * customer link is refreshed). Returns null when the changed rows include a
 * user role snapshot, meaning "cannot narrow — do a full pass".
 */
export async function findChangedTicketIds(
  prisma: PrismaClient,
  integrationId: string,
  since: Date,
): Promise<number[] | null> {
  const changed = { integrationId, fetchedAt: { gt: since } };

  if ((await prisma.rawEvent.count({ where: { ...changed, providerEventId: { startsWith: "user:" } } })) > 0) {
    return null;
  }

  const ticketIds = new Set<number>();

  // `fetchedAt` is a plain `timestamp(3)` holding UTC. A raw-SQL Date
  // parameter is serialized in the session's local zone, so pass an ISO
  // string and convert explicitly, as the typed Prisma queries above do.
  const sinceUtc = Prisma.sql`(${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

  const snapshots = await prisma.rawEvent.findMany({
    where: { ...changed, providerEventId: { startsWith: "ticket:" } },
    select: { providerEventId: true },
  });
  for (const { providerEventId } of snapshots) {
    const match = /^ticket:(\d+):/.exec(providerEventId);
    if (match) ticketIds.add(Number(match[1]));
  }

  // Audits carry the ticket id only in their payload, not their providerEventId.
  const audits = await prisma.$queryRaw<{ ticketId: string | null }[]>(Prisma.sql`
    SELECT DISTINCT ("payload"->>'ticket_id') AS "ticketId"
    FROM "raw_events"
    WHERE "integrationId" = ${integrationId}
      AND "fetchedAt" > ${sinceUtc}
      AND starts_with("providerEventId", 'ticket_audit:')
  `);
  for (const { ticketId } of audits) if (ticketId) ticketIds.add(Number(ticketId));

  const changedOrgIds = (
    await prisma.$queryRaw<{ orgId: string | null }[]>(Prisma.sql`
      SELECT DISTINCT ("payload"->>'id') AS "orgId"
      FROM "raw_events"
      WHERE "integrationId" = ${integrationId}
        AND "fetchedAt" > ${sinceUtc}
        AND starts_with("providerEventId", 'organization:')
    `)
  ).flatMap(({ orgId }) => (orgId ? [orgId] : []));
  if (changedOrgIds.length > 0) {
    const ofOrgs = await prisma.$queryRaw<{ ticketId: string | null }[]>(Prisma.sql`
      SELECT DISTINCT ("payload"->>'id') AS "ticketId"
      FROM "raw_events"
      WHERE "integrationId" = ${integrationId}
        AND starts_with("providerEventId", 'ticket:')
        AND "payload"->>'organization_id' IN (${Prisma.join(changedOrgIds)})
    `);
    for (const { ticketId } of ofOrgs) if (ticketId) ticketIds.add(Number(ticketId));
  }

  return [...ticketIds].filter(Number.isFinite);
}

/**
 * Derives, from everything ingested so far for one integration, the customers,
 * cases and events the shared projector persists (`CanonicalBatch`). Writes
 * nothing but the incremental watermark, and that only through the batch's
 * `afterProject` hook. Idempotent and safe to re-run: the projector reconciles
 * each case's events against what is stored and writes only the difference.
 *
 * The incremental mode's correctness rests on that idempotence: the
 * watermark only decides *which* tickets get re-derived, and re-deriving a
 * ticket that didn't actually change writes nothing.
 */
export async function buildZendeskBatch(
  prisma: PrismaClient,
  integrationId: string,
  scope: ZendeskNormalizationScope = {},
): Promise<CanonicalBatch> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });

  // A ticket-scoped run (webhook) isn't a view of the whole integration, so
  // it neither narrows by nor advances the watermark.
  if (scope.ticketIds) return deriveTickets(prisma, integration, scope.ticketIds, scope.ticketIds);

  // Read before deriving, so a RawEvent that lands mid-run is above the new
  // watermark and picked up next time rather than skipped.
  const highWater = await readHighWaterMark(prisma, integrationId);

  let ticketIds: number[] | undefined;
  if (scope.mode === "incremental" && integration.normalizedThroughFetchedAt) {
    const since = new Date(integration.normalizedThroughFetchedAt.getTime() - NORMALIZATION_OVERLAP_MS);
    ticketIds = (await findChangedTicketIds(prisma, integrationId, since)) ?? undefined;
  }

  const batch = await deriveTickets(prisma, integration, ticketIds);
  if (highWater) {
    batch.afterProject = async () => {
      await prisma.integration.update({
        where: { id: integrationId },
        data: { normalizedThroughFetchedAt: highWater.fetchedAt, normalizedThroughId: highWater.id },
      });
    };
  }
  return batch;
}

/** The tickets `ticket_deleted:` raw events record as gone, optionally narrowed to some ids. */
async function findDeletedTicketIds(prisma: PrismaClient, integrationId: string, ticketIds?: number[]): Promise<string[]> {
  const rows = await prisma.rawEvent.findMany({
    where: {
      integrationId,
      providerEventId: { startsWith: "ticket_deleted:" },
      ...(ticketIds ? { OR: ticketIds.map((id) => ({ providerEventId: { startsWith: `ticket_deleted:${id}:` } })) } : {}),
    },
    select: { payload: true },
  });
  return [...new Set(rows.map((row) => String((row.payload as { ticketId: number }).ticketId)))];
}

/**
 * Derives the given tickets (or every ticket when `ticketIds` is omitted)
 * from their stored RawEvents.
 */
async function deriveTickets(
  prisma: PrismaClient,
  integration: { id: string; organizationId: string },
  ticketIds?: number[],
  /** Narrows which deletions are read: a webhook's own tickets. Omitted, every recorded deletion is, even when `ticketIds` narrows the rest (a deletion's ticket has no new snapshot, so the watermark's changed set never names it). */
  deletionScope?: number[],
): Promise<CanonicalBatch> {
  const integrationId = integration.id;

  const batch: CanonicalBatch = { customers: [], cases: [], eventGroups: [], deletedCaseExternalIds: [], failures: [] };
  // Tickets the source reports gone (the incremental export's `deleted` status,
  // a 404 on refetch) are recorded as raw events by ingestion; the projector
  // soft-deletes their cases. Always read, whatever the scope narrows to.
  batch.deletedCaseExternalIds = await findDeletedTicketIds(prisma, integrationId, deletionScope);
  if (ticketIds && ticketIds.length === 0) return batch;

  const [orgRows, userRows] = await Promise.all([
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "organization:" } },
      select: { id: true, payload: true, fetchedAt: true },
      orderBy: { fetchedAt: "asc" },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "user:" } },
      select: { id: true, payload: true, fetchedAt: true },
    }),
  ]);

  const latestOrgs = latestSnapshotById<ZendeskOrganization>(orgRows);
  batch.customers = [...latestOrgs.values()].map(({ value: org }): CustomerIdentityFact => ({
    ...zendeskOrganizationIdentity(org.id),
    name: org.name,
  }));

  const userRoles: ZendeskUserRoles = new Map(
    [...latestSnapshotById<ZendeskUser>(userRows).values()].map(({ value }) => [value.id, value.role]),
  );

  const batches: (number[] | undefined)[] = [];
  if (ticketIds) for (let i = 0; i < ticketIds.length; i += TICKET_BATCH_SIZE) batches.push(ticketIds.slice(i, i + TICKET_BATCH_SIZE));
  else batches.push(undefined);

  for (const ids of batches) {
    const [ticketRows, auditRows] = await Promise.all([
      prisma.rawEvent.findMany({
        where: {
          integrationId,
          providerEventId: { startsWith: "ticket:" },
          ...(ids ? { OR: ids.map((id) => ({ providerEventId: { startsWith: `ticket:${id}:` } })) } : {}),
        },
        select: { id: true, payload: true, fetchedAt: true },
        orderBy: { fetchedAt: "asc" },
      }),
      prisma.rawEvent.findMany({
        where: {
          integrationId,
          providerEventId: { startsWith: "ticket_audit:" },
          // Audits carry no ticket id in their own providerEventId (they're
          // keyed by the audit's own id — see rawEvents.ts) — the ticket
          // scope has to go through the JSON payload instead.
          ...(ids ? { OR: ids.map((id) => ({ payload: { path: ["ticket_id"], equals: id } })) } : {}),
        },
        select: { id: true, payload: true, fetchedAt: true },
      }),
    ]);

    const latestTickets = latestSnapshotById<ZendeskTicket>(ticketRows);
    const auditsByTicketId = groupAuditsByTicketId(auditRows);
    deriveTicketFacts(latestTickets, auditsByTicketId, userRoles, batch);
  }

  return batch;
}

function deriveTicketFacts(
  latestTickets: ReturnType<typeof latestSnapshotById<ZendeskTicket>>,
  auditsByTicketId: Map<number, AuditRecord[]>,
  userRoles: ZendeskUserRoles,
  batch: CanonicalBatch,
): void {
  const cases: CaseFacts[] = batch.cases;
  const eventGroups: EventGroup[] = batch.eventGroups;
  const failures: ProjectionFailure[] = batch.failures;

  for (const { rawEventId: ticketRawEventId, value: ticket, rawEventIds: ticketSnapshotRawEventIds } of latestTickets.values()) {
    try {
      // Defense in depth: ingestion records "deleted"-status tickets as
      // `ticket_deleted:` raw events and never as tickets, but a row ingested
      // before that existed could still be sitting here —
      // normalizeZendeskStatus has no mapping for "deleted" and would throw.
      if (ticket.status === "deleted") {
        batch.deletedCaseExternalIds.push(String(ticket.id));
        continue;
      }

      const auditsForTicket = auditsByTicketId.get(ticket.id) ?? [];
      const derived = deriveNormalizedEventsForTicket(ticket, auditsForTicket, ticketRawEventId, userRoles);
      const closedAt = deriveCaseClosedAt(ticket, derived);

      cases.push({
        externalId: String(ticket.id),
        subject: ticket.subject,
        priority: ticket.priority,
        channel: ticket.via?.channel ?? null,
        openedAt: new Date(ticket.created_at),
        closedAt,
        customer: ticket.organization_id != null ? zendeskOrganizationIdentity(ticket.organization_id) : null,
        // Generic SLA policy match input (`SLAPolicyMatch.conditions`, field
        // `"tags"`) — see `extractMatchFromFilter` in ./policies.
        tags: ticket.tags ?? [],
        // Every other Zendesk SLA condition field this importer can resolve
        // (status, type, group_id, assignee_id, ...) — see
        // `zendeskConditionAttributes` above.
        attributes: zendeskConditionAttributes(ticket),
        // Display-only, like `subject` — never feeds customer resolution, SLA
        // matching, calendar overrides, or anomaly grouping.
        requesterName: ticket.requester_name ?? null,
        assigneeName: ticket.assignee_name ?? null,
      });
      eventGroups.push({
        target: { caseExternalId: String(ticket.id) },
        // Every RawEvent this ticket's own derivation could ever have sourced
        // an event from — every ticket snapshot (each re-fetch with changes is
        // a new RawEvent, and an older one's case_created must not linger) plus
        // its own audits. Scoping the reconcile to just these keeps it from
        // wiping events another provider (Jira/Linear) wrote onto the same case.
        ownRawEventIds: [...ticketSnapshotRawEventIds, ...auditsForTicket.map((a) => a.rawEventId)],
        events: derived.map((event) => ({
          type: event.type,
          occurredAt: new Date(event.occurredAt),
          actor: event.actor,
          sourceRole: ZENDESK_SOURCE_ROLE,
          fromState: event.fromState,
          toState: event.toState,
          sourceRawEventId: event.sourceRawEventId,
          sourceSequence: event.sourceSequence,
        })),
        recordId: String(ticket.id),
      });
    } catch (error) {
      failures.push({ id: String(ticket.id), error: error instanceof Error ? error.message : String(error) });
    }
  }
}
