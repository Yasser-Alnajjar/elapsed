import type { Actor, CanonicalPriority, NormalizedState } from "@sla/core";
import type { IntegrationProvider } from "@sla/db";
import type { CaseFacts, CustomerIdentityFact, EventGroup, NormalizedEventFact } from "@sla/ingestion";
import { MappingError, type MappingErrorCode } from "./errors";
import { evaluatePath } from "./path";
import type { CustomConfig } from "./schema";
import { evaluateDate, evaluateExpr, evaluateText } from "./transforms";
import { envOf, RAW_PREFIX } from "./shared";

/** A stored raw event, as normalization reads it. */
export interface RawRow {
  id: string;
  providerEventId: string;
  payload: unknown;
  fetchedAt: Date;
}

export const CUSTOM_SOURCE_ROLE = "ticket_source" as const;
/** Becomes the literal `"custom"` once the N9.8 migration adds the enum value. */
export const CUSTOM_PROVIDER = "custom" as IntegrationProvider;
/** A customer (or agent) comment this close to creation is the ticket's opening message, not a reply. */
export const OPENING_MESSAGE_WINDOW_MS = 60_000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 64;

export interface DerivedBatch {
  customers: CustomerIdentityFact[];
  cases: CaseFacts[];
  eventGroups: EventGroup[];
  deletedCaseExternalIds: string[];
  /** Records that could not be derived: the ticket id and a fixed code. */
  failures: { id: string; code: MappingErrorCode }[];
  /** Non-fatal observations (`unknown_priority`, `unknown_visibility`, ...), per ticket. */
  diagnostics: { id: string; code: string }[];
  /** B: distinct tickets the pass attempted (all stored tickets). */
  attempted: number;
  /** For the lifecycle guard: each derived case's lifecycle state, closed = true. */
  closedByExternalId: Map<string, boolean>;
  /** For the ceiling: ids of tickets that derive a case (live, not deleted). */
  caseExternalIds: string[];
}

const TERMINAL = new Set<NormalizedState>(["resolved", "closed"]);

interface TicketGroup {
  externalId: string;
  snapshots: { rowId: string; payload: unknown; fetchedAt: Date }[];
  comments: Map<string, { rowId: string; payload: unknown; fetchedAt: Date }>;
  history: Map<string, { rowId: string; payload: unknown; fetchedAt: Date }>;
  commentRowIds: string[];
  historyRowIds: string[];
  deleted: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function later(a: { fetchedAt: Date; rowId: string }, b: { fetchedAt: Date; rowId: string }): boolean {
  return a.fetchedAt.getTime() !== b.fetchedAt.getTime() ? a.fetchedAt > b.fetchedAt : a.rowId > b.rowId;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === "string" && ["true", "1", "yes"].includes(value.trim().toLowerCase()));
}

function mapStatus(config: CustomConfig, raw: string): NormalizedState {
  if (Object.hasOwn(config.valueMaps.status, raw)) return config.valueMaps.status[raw]!;
  if (config.unknownStatus === "open") return "open";
  throw new MappingError("unknown_status");
}

function mapRole(config: CustomConfig, raw: string | null): Actor | null {
  if (raw === null) return null;
  const map = config.valueMaps.authorRole;
  if (!map || !Object.hasOwn(map, raw)) return null;
  return map[raw]!;
}

/** Public/private for one comment: `true` public, `false` private, `null` unknown. */
function isPublic(config: CustomConfig, comment: unknown): boolean | null {
  const mapping = config.commentMapping;
  if (!mapping) return null;
  if (mapping.isPublic === undefined) return config.commentVisibilityAcknowledged ? true : null;
  const value = evaluateExpr(mapping.isPublic, comment, envOf(config));
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  const text = String(value);
  const visibility = config.valueMaps.visibility;
  if (visibility && Object.hasOwn(visibility, text)) return visibility[text] === "public";
  return null;
}

/**
 * The pure core of normalization: `deriveBatch(config, rows)` turns stored raw
 * events into canonical facts and events. It reads nothing but its arguments
 * and the injected source timestamps, so the preview, the dry-run diff and the
 * worker run exactly this code, and normalizing the same rows twice, whenever
 * they were fetched, gives identical output (plan 09, 9.1).
 *
 * History is never invented (plan 09, 5.3): `state_changed` and `case_closed`
 * exist only where the source supplied a status history, or, for
 * `case_closed`, a closure timestamp of its own. `updatedAt` is never used as
 * a closure time.
 */
export function deriveBatch(config: CustomConfig, rows: readonly RawRow[]): DerivedBatch {
  const env = envOf(config);
  const groups = new Map<string, TicketGroup>();
  const group = (id: string): TicketGroup => {
    let g = groups.get(id);
    if (!g) {
      g = { externalId: id, snapshots: [], comments: new Map(), history: new Map(), commentRowIds: [], historyRowIds: [], deleted: false };
      groups.set(id, g);
    }
    return g;
  };

  const sorted = [...rows].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of sorted) {
    const payload = row.payload;
    if (row.providerEventId.startsWith(RAW_PREFIX.ticket)) {
      let id: string | null = null;
      try {
        id = evaluateText(config.mapping.id, payload, env);
      } catch {
        id = null;
      }
      if (id) group(id).snapshots.push({ rowId: row.id, payload, fetchedAt: row.fetchedAt });
    } else if (row.providerEventId.startsWith(RAW_PREFIX.comment) && isPlainObject(payload) && typeof payload.t === "string" && config.commentMapping) {
      const g = group(payload.t);
      g.commentRowIds.push(row.id);
      let commentId: string | null = null;
      try {
        commentId = evaluateText(config.commentMapping.id, payload.i, env);
      } catch {
        commentId = null;
      }
      if (commentId) {
        const entry = { rowId: row.id, payload: payload.i, fetchedAt: row.fetchedAt };
        const existing = g.comments.get(commentId);
        if (!existing || later(entry, existing)) g.comments.set(commentId, entry);
      }
    } else if (row.providerEventId.startsWith(RAW_PREFIX.history) && isPlainObject(payload) && typeof payload.t === "string" && config.statusHistory) {
      const g = group(payload.t);
      g.historyRowIds.push(row.id);
      const entryKey = row.providerEventId.slice(RAW_PREFIX.history.length + payload.t.length + 1).split(":")[0] ?? row.id;
      const entry = { rowId: row.id, payload: payload.i, fetchedAt: row.fetchedAt };
      const existing = g.history.get(entryKey);
      if (!existing || later(entry, existing)) g.history.set(entryKey, entry);
    } else if (row.providerEventId.startsWith(RAW_PREFIX.deleted) && isPlainObject(payload) && typeof payload.t === "string") {
      group(payload.t).deleted = true;
    }
  }

  const out: DerivedBatch = {
    customers: [],
    cases: [],
    eventGroups: [],
    deletedCaseExternalIds: [],
    failures: [],
    diagnostics: [],
    attempted: 0,
    closedByExternalId: new Map(),
    caseExternalIds: [],
  };
  const customers = new Map<string, CustomerIdentityFact>();

  for (const g of [...groups.values()].sort((a, b) => (a.externalId < b.externalId ? -1 : 1))) {
    if (g.snapshots.length === 0) continue; // comments/deletions of a ticket never seen: nothing to derive
    out.attempted += 1;
    const latest = g.snapshots.reduce((acc, s) => (later(s, acc) ? s : acc));
    const earliest = g.snapshots.reduce((acc, s) => (later(acc, s) ? s : acc));
    try {
      const derived = deriveTicket(config, g, latest, earliest, env, out);
      if (derived === "deleted") {
        out.deletedCaseExternalIds.push(g.externalId);
        continue;
      }
      out.cases.push(derived.facts);
      out.eventGroups.push(derived.group);
      out.closedByExternalId.set(g.externalId, derived.facts.closedAt !== null);
      out.caseExternalIds.push(g.externalId);
      if (derived.customer) customers.set(derived.customer.externalId, derived.customer);
    } catch (error) {
      if (!(error instanceof MappingError)) throw error;
      out.failures.push({ id: g.externalId, code: error.code });
    }
  }
  out.customers = [...customers.values()];
  return out;
}

function deriveTicket(
  config: CustomConfig,
  g: TicketGroup,
  latest: { rowId: string; payload: unknown },
  earliest: { rowId: string },
  env: ReturnType<typeof envOf>,
  out: DerivedBatch,
): "deleted" | { facts: CaseFacts; group: EventGroup; customer: CustomerIdentityFact | null } {
  const ticket = latest.payload;
  const m = config.mapping;

  const rawStatus = evaluateText(m.status, ticket, env);
  if (rawStatus === null) throw new MappingError("missing_required");
  const deletion = config.deletion;
  if (
    g.deleted ||
    (deletion?.statusValues && deletion.statusValues.includes(rawStatus)) ||
    (deletion?.flagPath && truthy(evaluatePath(deletion.flagPath, ticket)[0]))
  ) {
    return "deleted";
  }
  const status = mapStatus(config, rawStatus);
  const openedAt = evaluateDate(m.createdAt, ticket, env);
  if (openedAt === null) throw new MappingError("missing_required");

  // Replies --------------------------------------------------------------------
  interface Comment {
    rowId: string;
    id: string;
    createdAt: Date;
    role: Actor | null;
    publicFlag: boolean | null;
  }
  const comments: Comment[] = [];
  if (config.commentMapping && config.comments) {
    const mapping = config.commentMapping;
    const sources: { rowId: string; doc: unknown }[] = config.comments.request
      ? [...g.comments.values()].map((c) => ({ rowId: c.rowId, doc: c.payload }))
      : evaluatePath(config.comments.itemsPath, ticket).flatMap((match) => (Array.isArray(match) ? match : [match])).map((doc) => ({ rowId: latest.rowId, doc }));
    for (const source of sources) {
      if (!isPlainObject(source.doc)) continue;
      const id = evaluateText(mapping.id, source.doc, env);
      const createdAt = evaluateDate(mapping.createdAt, source.doc, env);
      if (id === null || createdAt === null) throw new MappingError("missing_required");
      const role = mapRole(config, evaluateText(mapping.authorRole, source.doc, env));
      comments.push({ rowId: source.rowId, id, createdAt, role, publicFlag: isPublic(config, source.doc) });
    }
    comments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // Creation actor ----------------------------------------------------------------
  let creator: Actor | null = null;
  const full = config.slaMode === "full";
  const ca = config.creationActor;
  if (ca?.type === "assume_customer") creator = "customer";
  else if (ca?.type === "path") creator = mapRole(config, evaluateText(ca.path, ticket, env));
  else if (ca?.type === "first_comment_author") creator = comments[0]?.role ?? null;
  if (full && creator === null) throw new MappingError("creation_actor_unknown");

  // Status history ---------------------------------------------------------------
  const events: NormalizedEventFact[] = [];
  let sequence = 0;
  const hist = config.statusHistory;
  let initialState: NormalizedState | null = null;
  const stateEvents: NormalizedEventFact[] = [];
  let lastHistoryState: NormalizedState | null = null;
  if (hist && g.history.size > 0) {
    const entries = [...g.history.values()].map((e) => ({
      rowId: e.rowId,
      changedAt: evaluateDate(hist.mapping.changedAt, e.payload, env),
      to: evaluateText(hist.mapping.toStatus, e.payload, env),
      from: hist.mapping.fromStatus ? evaluateText(hist.mapping.fromStatus, e.payload, env) : null,
    }));
    if (entries.some((e) => e.changedAt === null || e.to === null)) throw new MappingError("missing_required");
    entries.sort((a, b) => a.changedAt!.getTime() - b.changedAt!.getTime() || (a.rowId < b.rowId ? -1 : 1));
    initialState = entries[0]!.from !== null ? mapStatus(config, entries[0]!.from!) : null;
    let current: NormalizedState | null = initialState;
    for (const entry of entries) {
      const to = mapStatus(config, entry.to!);
      if (to === current) continue;
      sequence += 1;
      stateEvents.push({
        type: TERMINAL.has(to) ? "case_closed" : "state_changed",
        occurredAt: entry.changedAt!,
        actor: "system",
        sourceRole: CUSTOM_SOURCE_ROLE,
        fromState: current,
        toState: to,
        sourceRawEventId: entry.rowId,
        sourceSequence: sequence,
      });
      current = to;
    }
    lastHistoryState = current;
  }

  events.push({
    type: "case_created",
    occurredAt: openedAt,
    actor: creator ?? "system",
    sourceRole: CUSTOM_SOURCE_ROLE,
    fromState: null,
    toState: initialState,
    sourceRawEventId: earliest.rowId,
    sourceSequence: 0,
  });
  events.push(...stateEvents);

  // Closure --------------------------------------------------------------------
  let closedAt: Date | null = null;
  if (hist && g.history.size > 0) {
    const lastEvent = stateEvents[stateEvents.length - 1];
    if (lastHistoryState !== null && TERMINAL.has(lastHistoryState) && lastEvent) closedAt = lastEvent.occurredAt;
    else if (TERMINAL.has(status) && !(lastHistoryState !== null && TERMINAL.has(lastHistoryState))) {
      out.diagnostics.push({ id: g.externalId, code: "history_status_mismatch" });
    }
  } else if (TERMINAL.has(status)) {
    const closed = m.closedAt ? evaluateDate(m.closedAt, ticket, env) : null;
    if (closed !== null) {
      if (closed.getTime() < openedAt.getTime()) throw new MappingError("invalid_date");
      sequence += 1;
      events.push({
        type: "case_closed",
        occurredAt: closed,
        actor: "system",
        sourceRole: CUSTOM_SOURCE_ROLE,
        fromState: null,
        toState: status,
        sourceRawEventId: latest.rowId,
        sourceSequence: sequence,
      });
      closedAt = closed;
    } else {
      // Resolution cannot complete without a source-supplied closure time (U7); `updatedAt` is never substituted.
      out.diagnostics.push({ id: g.externalId, code: "terminal_status_without_closure_timestamp" });
    }
  }

  // Replies after the structural events, in source order.
  const openingWindowEnd = openedAt.getTime() + OPENING_MESSAGE_WINDOW_MS;
  let openingSkipped = false;
  for (const comment of comments) {
    if (comment.role === null || comment.role === "system") continue;
    if (comment.publicFlag === null) {
      out.diagnostics.push({ id: g.externalId, code: "unknown_visibility" });
      continue;
    }
    if (!comment.publicFlag) continue;
    if (!openingSkipped && comment.createdAt.getTime() <= openingWindowEnd && comment.role === creator) {
      openingSkipped = true; // the ticket's opening message is `case_created`, never a reply
      continue;
    }
    openingSkipped = true;
    sequence += 1;
    events.push({
      type: comment.role === "agent" ? "agent_replied" : "customer_replied",
      occurredAt: comment.createdAt,
      actor: comment.role,
      sourceRole: CUSTOM_SOURCE_ROLE,
      fromState: null,
      toState: null,
      sourceRawEventId: comment.rowId,
      sourceSequence: sequence,
    });
  }
  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.sourceSequence - b.sourceSequence);

  // Case facts ---------------------------------------------------------------------
  let priority: CanonicalPriority | null = null;
  if (m.priority) {
    const rawPriority = evaluateText(m.priority, ticket, env);
    if (rawPriority !== null) {
      const map = config.valueMaps.priority;
      if (map && Object.hasOwn(map, rawPriority)) priority = map[rawPriority]!;
      else out.diagnostics.push({ id: g.externalId, code: "unknown_priority" });
    }
  }
  let customer: CustomerIdentityFact | null = null;
  let customerRef: CaseFacts["customer"] = null;
  if (m.customerId) {
    const customerId = evaluateText(m.customerId, ticket, env);
    if (customerId) {
      const name = (m.customerName ? evaluateText(m.customerName, ticket, env) : null) ?? `Customer ${customerId}`;
      customerRef = { provider: CUSTOM_PROVIDER, kind: "customer", externalId: customerId };
      customer = { ...customerRef, name: name.slice(0, 200) };
    }
  }
  let tags: string[] | undefined;
  if (m.tags) {
    const raw = evaluatePath(m.tags, ticket)[0];
    tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, MAX_TAG_LENGTH)).slice(0, MAX_TAGS) : [];
  }

  const facts: CaseFacts = {
    externalId: g.externalId,
    subject: m.title ? (evaluateText(m.title, ticket, env)?.slice(0, 500) ?? null) : null,
    assigneeName: null,
    priority,
    channel: m.channel ? (evaluateText(m.channel, ticket, env)?.slice(0, 64) ?? null) : null,
    openedAt,
    closedAt,
    customer: customerRef,
    ...(tags !== undefined ? { tags } : {}),
  };
  const ownRawEventIds = [...g.snapshots.map((s) => s.rowId), ...g.commentRowIds, ...g.historyRowIds];
  return {
    facts,
    customer,
    group: { target: { caseExternalId: g.externalId }, ownRawEventIds, events, recordId: g.externalId },
  };
}
