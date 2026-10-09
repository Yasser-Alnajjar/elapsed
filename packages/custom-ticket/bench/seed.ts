import { createHash } from "node:crypto";
import type { PrismaClient } from "@sla/db";
import { RAW_PREFIX, computeSourceHash, projectByPaths, commentPaths, ticketPaths, parseConfig, type CustomConfig } from "../src";
import benchConfigJson from "./bench-config.json" with { type: "json" };

/**
 * Synthetic, custom-shaped data for the plan 09 §6.10 benchmark. Raw events
 * are built exactly as `runCustomIngest` stores them (whitelist projection,
 * content-hashed ids, `{ t, i }` comment bodies), so the real `deriveBatch`
 * and the real projector do all the work; nothing is inserted into
 * `NormalizedEvent`, `Case` or `Commitment` directly. Deterministic per seed.
 */

export interface Profile {
  name: "base" | "worst";
  /** Raw snapshots stored per ticket (each a real change at the source). */
  snapshotsPerTicket: number;
  /** Comments per ticket, fetched from the separate comments endpoint. */
  commentsPerTicket: number;
  /** Characters of mapped comment body (stored, because `body` is mapped). */
  commentBodyChars: number;
  /** Share of tickets closed with a source closure time. */
  closedRatio: number;
}

export const PROFILES: Record<Profile["name"], Profile> = {
  // Assumption, stated in the report: no design partner data is available, so
  // a modest helpdesk ticket: a few edits, a short exchange.
  base: { name: "base", snapshotsPerTicket: 3, commentsPerTicket: 5, commentBodyChars: 400, closedRatio: 0.6 },
  // The plan's worst-case multiplicities: 10 snapshots, 20 comments, large bodies.
  worst: { name: "worst", snapshotsPerTicket: 10, commentsPerTicket: 20, commentBodyChars: 3000, closedRatio: 0.6 },
};

export function benchConfig(): CustomConfig {
  const parsed = parseConfig(benchConfigJson);
  if (!parsed.ok) throw new Error(`bench-config.json is invalid: ${JSON.stringify(parsed.issues)}`);
  return parsed.config;
}

/** A small deterministic PRNG (mulberry32), so a tier is the same data on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const STATES_OPEN = ["new", "open", "waiting"] as const;

export interface TicketModel {
  id: string;
  createdAt: number;
  closedAt: number | null;
  priority: string;
  account: number;
}

export function ticketItem(t: TicketModel, revision: number, state: string, closedAt: number | null) {
  return {
    id: t.id,
    created_at: new Date(t.createdAt).toISOString(),
    updated_at: new Date(t.createdAt + (revision + 1) * HOUR).toISOString(),
    resolved_at: closedAt === null ? null : new Date(closedAt).toISOString(),
    state,
    subject: `Bench ticket ${t.id} revision ${revision}`,
    priority: t.priority,
    account: { id: `A-${t.account}`, name: `Bench Customer ${t.account}` },
    labels: ["bench", `rev-${revision}`],
    source: "email",
    // Unmapped: must never reach storage (the projection drops it).
    internal_notes: "not stored",
  };
}

export function commentItem(t: TicketModel, index: number, body: string) {
  const author = index % 2 === 0 ? "requester" : "agent";
  return {
    id: `${t.id}-c${index}`,
    at: new Date(t.createdAt + 20_000 + index * 37 * 60_000).toISOString(),
    author: { type: author, name: author === "agent" ? "Agent" : "Customer" },
    public: index % 7 !== 6,
    body,
  };
}

export interface RawInsert {
  integrationId: string;
  providerEventId: string;
  sourceHash: string;
  payload: unknown;
  fetchedAt: Date;
}

export function snapshotRow(config: CustomConfig, integrationId: string, item: unknown, fetchedAt: Date): RawInsert {
  const projection = projectByPaths(item, ticketPaths(config));
  const hash = computeSourceHash(projection);
  const id = (item as { id: string }).id;
  return { integrationId, providerEventId: `${RAW_PREFIX.ticket}${id}:${hash}`, sourceHash: hash, payload: projection, fetchedAt };
}

export function commentRow(config: CustomConfig, integrationId: string, ticketId: string, comment: { id: string }, fetchedAt: Date): RawInsert {
  const body = { t: ticketId, i: projectByPaths(comment, commentPaths(config)) };
  const hash = computeSourceHash(body);
  return { integrationId, providerEventId: `${RAW_PREFIX.comment}${ticketId}:${comment.id}:${hash}`, sourceHash: hash, payload: body, fetchedAt };
}

export async function insertRaw(prisma: PrismaClient, rows: RawInsert[], batch = 2000): Promise<void> {
  for (let i = 0; i < rows.length; i += batch) {
    await prisma.rawEvent.createMany({ data: rows.slice(i, i + batch) as never, skipDuplicates: true });
  }
}

export interface SeededTier {
  organizationId: string;
  integrationId: string;
  tickets: TicketModel[];
  rawRows: number;
  /** Raw rows of the tickets held back by `deferShare`, for a later "second import run". */
  deferred: RawInsert[];
}

export interface SeedOptions {
  /**
   * Share of tickets whose raw rows are returned instead of inserted, so an
   * import read over two runs can be replayed (the first pass sees the rest).
   */
  deferShare?: number;
  /** Integration state at seed time; defaults to an import just completed by ingest (see `importCompleted`). */
  importState?: "in_progress" | "completed";
}

/**
 * One organization with a native always-open policy (first response 60 min,
 * resolution 480 min), a connected `custom` integration paused by the operator
 * (so no HTTP ingest runs; the benchmark measures the DB-side sweep only, as
 * §6.10 defines it) and `tickets` tickets of stored raw events.
 */
export async function seedTier(prisma: PrismaClient, tickets: number, profile: Profile, label: string, seed = 1, options: SeedOptions = {}): Promise<SeededTier> {
  const config = benchConfig();
  const random = rng(seed * 7919 + tickets);
  const organization = await prisma.organization.create({ data: { name: `Bench ${label}` } });
  const calendar = await prisma.businessCalendar.create({ data: { organizationId: organization.id, name: "Always open (bench)" } });
  const calendarVersion = await prisma.businessCalendarVersion.create({
    data: { calendarId: calendar.id, version: 1, timezone: "UTC", weekly: {}, holidays: [], alwaysOpen: true, source: "native" },
  });
  const policy = await prisma.sLAPolicy.create({ data: { organizationId: organization.id, name: "Default (bench)", source: "native" } });
  await prisma.sLAPolicyVersion.create({
    data: {
      policyId: policy.id,
      version: 1,
      match: {},
      targets: [
        { kind: "first_response", minutes: 60 },
        { kind: "resolution", minutes: 480 },
      ],
      pauseOnStates: [],
      calendarVersionId: calendarVersion.id,
      warnAtPercent: [80],
      effectiveFrom: new Date(0),
      source: "native",
    },
  });
  const integration = await prisma.integration.create({
    data: {
      organizationId: organization.id,
      provider: "custom",
      status: "connected",
      activeConfigVersion: 1,
      pollingPausedAt: new Date(),
      slaSupport: { unsupportedKinds: [], limitations: ["no_status_history"] },
      ...importState(options.importState ?? "completed"),
    },
  });
  await prisma.customProviderConfigVersion.create({
    data: {
      organizationId: organization.id,
      integrationId: integration.id,
      version: 1,
      schemaVersion: config.schemaVersion,
      config: benchConfigJson as never,
      configHash: createHash("sha256").update(JSON.stringify(benchConfigJson)).digest("hex"),
      validatedAt: new Date(),
      note: "benchmark",
    },
  });

  const now = Date.now();
  const models: TicketModel[] = [];
  const rows: RawInsert[] = [];
  const deferred: RawInsert[] = [];
  const keep = Math.round(tickets * (1 - (options.deferShare ?? 0)));
  const body = "x".repeat(profile.commentBodyChars);
  for (let n = 0; n < tickets; n += 1) {
    // Created within the last 90 days (the default import window).
    const createdAt = now - Math.floor(random() * 89 * 24) * HOUR - 2 * HOUR;
    const closed = random() < profile.closedRatio;
    const t: TicketModel = { id: `B-${n + 1}`, createdAt, closedAt: closed ? createdAt + (1 + Math.floor(random() * 40)) * HOUR : null, priority: ["p1", "p2", "p3", "p4"][n % 4]!, account: (n % 200) + 1 };
    models.push(t);
    const target = n < keep ? rows : deferred;
    for (let s = 0; s < profile.snapshotsPerTicket; s += 1) {
      const last = s === profile.snapshotsPerTicket - 1;
      const state = last && t.closedAt !== null ? "solved" : STATES_OPEN[s % STATES_OPEN.length]!;
      target.push(snapshotRow(config, integration.id, ticketItem(t, s, state, last ? t.closedAt : null), new Date(createdAt + (s + 1) * HOUR)));
    }
    for (let c = 0; c < profile.commentsPerTicket; c += 1) {
      target.push(commentRow(config, integration.id, t.id, commentItem(t, c, body), new Date(createdAt + HOUR)));
    }
  }
  await insertRaw(prisma, rows);
  return { organizationId: organization.id, integrationId: integration.id, tickets: models, rawRows: rows.length, deferred };
}

/**
 * The integration fields the worker would have written by the time the pass
 * runs. The benchmark's integration is paused (no HTTP ingest), so the worker
 * never writes sync health itself; these stand in for it.
 *
 * - `in_progress`: ingest has not yet read the whole window and no pass has
 *   ever succeeded, so the source is stale and breach alerts are held (D13(b)).
 * - `completed`: ingest has just read the last page (`backfillCompletedAt`),
 *   and the pass that completes the import is about to run. In the real cycle
 *   that pass's evaluation already sees the `lastSuccessfulSyncAt` the same run
 *   writes (sync health is written before evaluation), so the source is fresh
 *   and real breach alerts are claimed; the instant is set just before
 *   `backfillCompletedAt` so the pass still classifies as the import's.
 */
export function importState(state: "in_progress" | "completed", at = new Date()) {
  return state === "in_progress"
    ? { cursor: { backfillCompletedAt: null }, lastSuccessfulSyncAt: null }
    : { cursor: { backfillCompletedAt: at.toISOString() }, lastSuccessfulSyncAt: new Date(at.getTime() - 1) };
}
