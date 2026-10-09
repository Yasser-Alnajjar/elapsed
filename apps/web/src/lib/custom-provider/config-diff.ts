import { createHash } from "node:crypto";
import {
  MAX_TICKETS_PER_RUN,
  commentPaths,
  deriveBatch,
  firstFiringGuard,
  historyPaths,
  liveCaseCeiling,
  loadActiveConfig,
  loadRawRows,
  pageSizeOf,
  parsePath,
  ticketPaths,
  type CustomConfig,
  type DerivedBatch,
  type GuardCode,
  type PathSegment,
} from "@sla/custom-ticket";
import { caseFieldsChanged, diffNormalizedEvents, normalizedEventKey, sameJson, type StoredCaseFields } from "@sla/ingestion";
import type { PrismaClient } from "@sla/db";

/**
 * The configuration dry-run diff of plan 09, 6.8 (N9.12-F1): before a new
 * version is activated, `deriveBatch` runs the proposed configuration over the
 * integration's stored snapshots and the result is compared with what is
 * stored, cases by the projector's own change rule (`caseFieldsChanged`) and
 * events with `diffNormalizedEvents`, exactly as the next pass would project
 * them. Nothing is written: the loader runs in a READ ONLY transaction.
 */

/** Cases listed in full; the counts and the hash always cover every case. */
export const MAX_LISTED_CHANGES = 50;
/** The plan's arithmetic for one run (6.3): 5 requests per second for 120 s. Not a measurement. */
const REQUESTS_PER_RUN = 600;

export type CaseChangeKind = "changed" | "new" | "deleted" | "failing";

export interface DiffEvent {
  type: string;
  occurredAt: string;
  actor: string;
}

export interface CaseChange {
  externalId: string;
  kind: CaseChangeKind;
  /** The stored subject, or the derived one for a new case. */
  subject: string | null;
  /** Stored case columns the new version would change. */
  fields: string[];
  /** Open/closed flip of an existing live case. */
  lifecycle: "closes" | "reopens" | null;
  eventsAdded: DiffEvent[];
  eventsRemoved: DiffEvent[];
  /** For `failing`: the mapping error code the ticket would fail with. */
  failureCode?: string;
}

export type ReimportReason = "ticket_fields_not_stored" | "comment_fields_not_stored" | "comments_source_changed" | "history_not_stored";

export interface ConfigDiff {
  status: "no_stored_data" | "computed";
  /** Fields the stored snapshots do not contain (6.8, 7): a re-read of the window would be needed for them to take effect. */
  reimport: { reasons: ReimportReason[]; missingPaths: string[]; storedTickets: number; estimatedRuns: number } | null;
  summary: {
    ticketsCompared: number;
    casesChanged: number;
    casesNew: number;
    casesDeleted: number;
    casesFailing: number;
    eventsAdded: number;
    eventsRemoved: number;
    lifecycleFlips: number;
    customersNew: number;
    customersRenamed: number;
  };
  /** The guard the first pass under this version would abort on, if any (6.4). */
  guard: GuardCode | null;
  changes: CaseChange[];
  truncated: boolean;
  /** Binds an activation to exactly this diff; null when the version changes nothing. */
  hash: string | null;
}

/** What is stored for one live case, as the projector would compare it. */
export interface StoredCase extends StoredCaseFields {
  id: string;
  externalId: string;
}

export interface StoredEvent {
  id: string;
  caseId: string;
  sourceRawEventId: string;
  sourceSequence: number;
  type: string;
  occurredAt: Date;
  actor: string;
  sourceRole: string | null;
  fromState: string | null;
  toState: string | null;
}

export interface StoredState {
  /** Live (not soft-deleted) cases of the integration. */
  liveCases: StoredCase[];
  /** External ids of soft-deleted cases; the projector never un-deletes them (6.5), so they are not reported. */
  deletedExternalIds: Set<string>;
  /** Events of the live cases, issue links excluded (they belong to the link projector). */
  events: StoredEvent[];
  /** Customer ids by the custom provider's customer external id. */
  customerIdByExternalId: Map<string, string>;
  customerNameById: Map<string, string>;
}

const eventView = (event: { type: string; occurredAt: Date | string; actor: string }): DiffEvent => ({
  type: event.type,
  occurredAt: new Date(event.occurredAt).toISOString(),
  actor: event.actor,
});

const sameTime = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());

/** The stored columns that differ, column by column, under the projector's own rule (`caseFieldsChanged`). */
function changedFields(stored: StoredCaseFields, facts: DerivedBatch["cases"][number], customerId: string | null): string[] {
  if (!caseFieldsChanged(stored, facts, customerId)) return [];
  const fields: string[] = [];
  if (stored.customerId !== customerId) fields.push("customer");
  if (stored.subject !== facts.subject) fields.push("subject");
  if (stored.assigneeName !== facts.assigneeName) fields.push("assignee");
  if (stored.priority !== facts.priority) fields.push("priority");
  if (stored.channel !== facts.channel) fields.push("channel");
  if (!sameTime(stored.closedAt, facts.closedAt)) fields.push("closedAt");
  if (facts.requesterName !== undefined && stored.requesterName !== facts.requesterName) fields.push("requester");
  if (facts.tier !== undefined && stored.tier !== facts.tier) fields.push("tier");
  if (facts.tags !== undefined && (stored.tags.length !== facts.tags.length || stored.tags.some((tag, i) => tag !== facts.tags![i]))) fields.push("tags");
  if (facts.attributes !== undefined && !sameJson(stored.attributes, facts.attributes)) fields.push("attributes");
  return fields;
}

/**
 * Pure comparison of a derived batch with the stored state. Every case is
 * counted and hashed; only the first `MAX_LISTED_CHANGES` are listed.
 */
export function diffDerivedAgainstStored(derived: DerivedBatch, stored: StoredState, ceiling: number = liveCaseCeiling()): Omit<ConfigDiff, "status" | "reimport"> {
  const liveByExternalId = new Map(stored.liveCases.map((c) => [c.externalId, c]));
  const eventsByCase = new Map<string, StoredEvent[]>();
  for (const event of stored.events) {
    const list = eventsByCase.get(event.caseId);
    if (list) list.push(event);
    else eventsByCase.set(event.caseId, [event]);
  }
  const groupByExternalId = new Map(derived.eventGroups.map((g) => ["caseExternalId" in g.target ? g.target.caseExternalId : g.recordId, g]));

  const changes: CaseChange[] = [];
  const signatures: string[] = [];
  const summary = { ticketsCompared: derived.attempted, casesChanged: 0, casesNew: 0, casesDeleted: 0, casesFailing: 0, eventsAdded: 0, eventsRemoved: 0, lifecycleFlips: 0, customersNew: 0, customersRenamed: 0 };
  // Customers are upserted per identity (a rename touches every case of that customer), so they are counted once here.
  for (const customer of derived.customers) {
    const id = stored.customerIdByExternalId.get(customer.externalId);
    if (id === undefined) {
      summary.customersNew += 1;
      signatures.push(`customer_new|${customer.externalId}|${customer.name}`);
    } else if (stored.customerNameById.get(id) !== customer.name) {
      summary.customersRenamed += 1;
      signatures.push(`customer_renamed|${customer.externalId}|${customer.name}`);
    }
  }

  for (const facts of derived.cases) {
    if (stored.deletedExternalIds.has(facts.externalId)) continue;
    const group = groupByExternalId.get(facts.externalId);
    const derivedEvents = group?.events ?? [];
    const live = liveByExternalId.get(facts.externalId);
    if (!live) {
      summary.casesNew += 1;
      summary.eventsAdded += derivedEvents.length;
      changes.push({ externalId: facts.externalId, kind: "new", subject: facts.subject, fields: [], lifecycle: null, eventsAdded: derivedEvents.map(eventView), eventsRemoved: [] });
      signatures.push(`new|${facts.externalId}|${derivedEvents.map(normalizedEventKey).join(",")}`);
      continue;
    }
    // The projector compares a group's events with the stored events that cite its own raw rows.
    const own = new Set(group?.ownRawEventIds ?? []);
    const storedEvents = (eventsByCase.get(live.id) ?? []).filter((e) => own.has(e.sourceRawEventId));
    const { toCreate, toDeleteIds } = diffNormalizedEvents(storedEvents, derivedEvents);
    const removed = new Set(toDeleteIds);
    const customerExternalId = facts.customer?.externalId ?? null;
    const resolvedCustomerId = customerExternalId === null ? null : (stored.customerIdByExternalId.get(customerExternalId) ?? `new:${customerExternalId}`);
    const fields = changedFields(live, facts, resolvedCustomerId);
    const wasClosed = live.closedAt !== null;
    const isClosed = facts.closedAt !== null;
    const lifecycle = wasClosed === isClosed ? null : isClosed ? "closes" : "reopens";
    if (fields.length === 0 && toCreate.length === 0 && removed.size === 0) continue;
    summary.casesChanged += 1;
    summary.eventsAdded += toCreate.length;
    summary.eventsRemoved += removed.size;
    if (lifecycle) summary.lifecycleFlips += 1;
    const eventsRemoved = storedEvents.filter((e) => removed.has(e.id));
    changes.push({ externalId: facts.externalId, kind: "changed", subject: live.subject, fields, lifecycle, eventsAdded: toCreate.map(eventView), eventsRemoved: eventsRemoved.map(eventView) });
    signatures.push(`changed|${facts.externalId}|${fields.join(",")}|+${toCreate.map(normalizedEventKey).join(",")}|-${[...removed].sort().join(",")}`);
  }

  for (const externalId of derived.deletedCaseExternalIds) {
    const live = liveByExternalId.get(externalId);
    if (!live) continue;
    summary.casesDeleted += 1;
    changes.push({ externalId, kind: "deleted", subject: live.subject, fields: [], lifecycle: null, eventsAdded: [], eventsRemoved: [] });
    signatures.push(`deleted|${externalId}`);
  }

  for (const failure of derived.failures) {
    summary.casesFailing += 1;
    const live = liveByExternalId.get(failure.id);
    changes.push({ externalId: failure.id, kind: "failing", subject: live?.subject ?? null, fields: [], lifecycle: null, eventsAdded: [], eventsRemoved: [], failureCode: failure.code });
    signatures.push(`failing|${failure.id}|${failure.code}`);
  }

  // The guards the first pass under this version would run (6.4), counted exactly as `normalizeCustom` counts them.
  const attemptedIds = new Set([...derived.caseExternalIds, ...derived.failures.map((f) => f.id), ...derived.deletedCaseExternalIds]);
  const guard = firstFiringGuard({
    L: stored.liveCases.length,
    B: derived.attempted,
    F: derived.failures.length,
    D: derived.deletedCaseExternalIds.filter((id) => liveByExternalId.has(id)).length,
    R: summary.lifecycleFlips,
    N: [...attemptedIds].filter((id) => !liveByExternalId.has(id)).length,
    C: ceiling,
  });

  const order: Record<CaseChangeKind, number> = { failing: 0, deleted: 1, changed: 2, new: 3 };
  changes.sort((a, b) => order[a.kind] - order[b.kind] || (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0));
  const hash = signatures.length === 0 ? null : createHash("sha256").update(signatures.sort().join("\n")).digest("hex");
  return { summary, guard, changes: changes.slice(0, MAX_LISTED_CHANGES), truncated: changes.length > MAX_LISTED_CHANGES, hash };
}

/** True when the stored path `stored` keeps everything at `wanted` (a prefix, with `[*]` covering any index). */
function covers(stored: readonly PathSegment[], wanted: readonly PathSegment[]): boolean {
  if (stored.length > wanted.length) return false;
  return stored.every((segment, i) => {
    const other = wanted[i]!;
    if (segment.kind === "wildcard") return other.kind !== "key";
    if (segment.kind === "key") return other.kind === "key" && other.name === segment.name;
    return other.kind === "index" && other.index === segment.index;
  });
}

function uncovered(storedPaths: readonly string[], wantedPaths: readonly string[]): string[] {
  const stored = storedPaths.map(parsePath).filter((p): p is PathSegment[] => p !== null);
  return wantedPaths.filter((path) => {
    const wanted = parsePath(path);
    return wanted !== null && !stored.some((s) => covers(s, wanted));
  });
}

/**
 * Which fields of the proposed version the stored snapshots cannot supply.
 * Snapshots keep only what the version that fetched them mapped (plan 09, 7);
 * the active version is the reference. Older rows are only re-read when the
 * ticket changes at the source, so until then the diff below is exactly what
 * the next pass would do with them.
 */
export function reimportNeeds(active: CustomConfig, proposed: CustomConfig): { reasons: ReimportReason[]; missingPaths: string[] } {
  const reasons: ReimportReason[] = [];
  const missing: string[] = [];
  const tickets = uncovered(ticketPaths(active), ticketPaths(proposed));
  if (tickets.length > 0) {
    reasons.push("ticket_fields_not_stored");
    missing.push(...tickets);
  }
  const separate = (config: CustomConfig) => Boolean(config.comments?.request);
  if (proposed.comments && separate(proposed) !== separate(active)) reasons.push("comments_source_changed");
  else if (separate(proposed)) {
    const comments = uncovered(commentPaths(active), commentPaths(proposed));
    if (comments.length > 0) {
      reasons.push("comment_fields_not_stored");
      missing.push(...comments);
    }
  }
  if (proposed.statusHistory && (!active.statusHistory || uncovered(historyPaths(active), historyPaths(proposed)).length > 0)) {
    reasons.push("history_not_stored");
    if (active.statusHistory) missing.push(...uncovered(historyPaths(active), historyPaths(proposed)));
  }
  return { reasons, missingPaths: [...new Set(missing)].sort() };
}

const STORED_CHUNK = 1000;

async function loadStoredState(db: PrismaClient, organizationId: string, integrationId: string): Promise<StoredState> {
  const cases = await db.case.findMany({
    where: { organizationId, sourceIntegrationId: integrationId },
    select: {
      id: true,
      externalId: true,
      deletedAt: true,
      customerId: true,
      subject: true,
      assigneeName: true,
      priority: true,
      channel: true,
      closedAt: true,
      requesterName: true,
      tier: true,
      tags: true,
      attributes: true,
    },
  });
  const liveCases: StoredCase[] = [];
  const deletedExternalIds = new Set<string>();
  for (const { deletedAt, ...row } of cases) {
    if (deletedAt) deletedExternalIds.add(row.externalId);
    else liveCases.push(row);
  }
  const events: StoredEvent[] = [];
  for (let i = 0; i < liveCases.length; i += STORED_CHUNK) {
    events.push(
      ...(await db.normalizedEvent.findMany({
        where: { caseId: { in: liveCases.slice(i, i + STORED_CHUNK).map((c) => c.id) }, type: { notIn: ["issue_linked", "issue_unlinked"] } },
        select: { id: true, caseId: true, sourceRawEventId: true, sourceSequence: true, type: true, occurredAt: true, actor: true, sourceRole: true, fromState: true, toState: true },
      })),
    );
  }
  const identities = await db.customerIdentity.findMany({
    where: { organizationId, provider: "custom", kind: "customer" },
    select: { externalId: true, customer: { select: { id: true, name: true } } },
  });
  return {
    liveCases,
    deletedExternalIds,
    events,
    customerIdByExternalId: new Map(identities.map((i) => [i.externalId, i.customer.id])),
    customerNameById: new Map(identities.map((i) => [i.customer.id, i.customer.name])),
  };
}

/**
 * Computes the dry-run diff of `proposed` against the organization's custom
 * integration. A first activation (no integration, no active version, or
 * nothing stored yet) has nothing to compare and returns `no_stored_data`.
 * Read-only by construction and enforced by a READ ONLY transaction.
 */
export async function computeConfigDiff(prisma: PrismaClient, organizationId: string, proposed: CustomConfig): Promise<ConfigDiff> {
  const empty: ConfigDiff = {
    status: "no_stored_data",
    reimport: null,
    summary: { ticketsCompared: 0, casesChanged: 0, casesNew: 0, casesDeleted: 0, casesFailing: 0, eventsAdded: 0, eventsRemoved: 0, lifecycleFlips: 0, customersNew: 0, customersRenamed: 0 },
    guard: null,
    changes: [],
    truncated: false,
    hash: null,
  };
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const db = tx as unknown as PrismaClient;
      const integration = await db.integration.findUnique({
        where: { organizationId_provider: { organizationId, provider: "custom" } },
        select: { id: true },
      });
      if (!integration) return empty;
      const active = await loadActiveConfig(db, integration.id);
      const rows = await loadRawRows(db, integration.id);
      if (!active || rows.length === 0) return empty;

      const derived = deriveBatch(proposed, rows);
      const stored = await loadStoredState(db, organizationId, integration.id);
      const needs = reimportNeeds(active.config, proposed);
      const storedTickets = derived.attempted;
      // An estimate from the plan's per-run limits (6.2, 6.3): listing pages plus one child request per ticket per child endpoint.
      const requests = Math.ceil(storedTickets / pageSizeOf(proposed.tickets.pagination)) + storedTickets * ((proposed.comments?.request ? 1 : 0) + (proposed.statusHistory ? 1 : 0));
      return {
        status: "computed",
        reimport:
          needs.reasons.length === 0
            ? null
            : {
                ...needs,
                storedTickets,
                estimatedRuns: Math.max(1, Math.ceil(storedTickets / MAX_TICKETS_PER_RUN), Math.ceil(requests / REQUESTS_PER_RUN)),
              },
        ...diffDerivedAgainstStored(derived, stored),
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
