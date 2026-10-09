import { createLogger, registerSecretValues } from "@sla/logger";
import {
  RunBudget,
  SafeHttpError,
  classifyError,
  classifyStatus,
  createSafeHttpClient,
  privateHostsAllowed,
  type SafeClassification,
  type SafeHttpClient,
} from "@sla/safe-http";
import { deriveBatch, type DerivedBatch, type RawRow } from "./derive";
import { fetchPage, type Endpoint } from "./fetcher";
import { MAX_PAGES_PER_RUN, MAX_TICKETS_PER_RUN, authHeaders, buildTicketEvents, sensitiveValues } from "./ingest";
import { MappingError, type MappingProblem } from "./errors";
import { START, type Position } from "./requests";
import type { CustomConfig } from "./schema";
import { SourceStatusError } from "./source-errors";
import { evaluateText } from "./transforms";
import { envOf } from "./shared";

/**
 * Outbound checks the wizard runs before activation (test connection, sample,
 * preview, full-listing measurement). They use the same client, limits and
 * destination rules as a real run, never store a response, and return only
 * safe classifications and, for a sample or preview, data that goes to the
 * owner's browser alone (plan 09, 8.5).
 */
const log = createLogger({ component: "custom_outbound" });

/** One line per failed check: the check name and a fixed code, never a URL, header or body. */
function logFailure(check: string, error: unknown): void {
  const e = error as { code?: unknown; status?: unknown; name?: unknown } | null;
  log.warn("custom_outbound_check_failed", { check, name: typeof e?.name === "string" ? e.name : "error", code: typeof e?.code === "string" ? e.code : null, status: typeof e?.status === "number" ? e.status : null });
}

export interface OutboundSession {
  config: CustomConfig;
  client: SafeHttpClient;
  budget: RunBudget;
  dispose(): Promise<void>;
}

export function openOutboundSession(config: CustomConfig, secrets: Record<string, string>, options: { totalMs?: number } = {}): OutboundSession {
  const headers = authHeaders(config.auth, secrets);
  const unregister = registerSecretValues(sensitiveValues(headers, secrets));
  const budget = new RunBudget({ totalMs: options.totalMs ?? 60_000 });
  const client = createSafeHttpClient({
    baseUrl: config.connection.baseUrl,
    budget,
    headers,
    secretValues: Object.values(secrets),
    destination: { allowPrivateHosts: privateHostsAllowed() },
    // Fewer retries than a real run: the owner is waiting.
    maxAttempts: 2,
    baseBackoffMs: 1_000,
  });
  return {
    config,
    client,
    budget,
    async dispose() {
      await client.close();
      unregister();
    },
  };
}

function ticketsEndpoint(config: CustomConfig): Endpoint {
  return { request: config.tickets.request, itemsPath: config.tickets.itemsPath, pagination: config.tickets.pagination };
}

/** The window an incremental source starts from, formatted for `{{updatedSince}}`. */
function updatedSinceVariable(config: CustomConfig, now: Date): { updatedSince?: string } {
  const incremental = config.tickets.incremental;
  if (!incremental) return {};
  const from = new Date(now.getTime() - config.importWindowDays * 86_400_000);
  return {
    updatedSince:
      incremental.format === "iso8601" ? from.toISOString() : String(incremental.format === "epoch_seconds" ? Math.floor(from.getTime() / 1000) : from.getTime()),
  };
}

export type ConnectionTest = { classification: SafeClassification; status?: number };

/** One request to the tickets endpoint. Returns a safe classification only. */
export async function testConnection(session: OutboundSession, now = new Date()): Promise<ConnectionTest> {
  try {
    const page = await fetchPage(session.client, ticketsEndpoint(session.config), START, updatedSinceVariable(session.config, now));
    void page;
    return { classification: "ok" };
  } catch (error) {
    logFailure("test", error);
    if (error instanceof SourceStatusError) return { classification: classifyStatus(error.status), status: error.status };
    return { classification: classifyError(error) };
  }
}

export interface Sample {
  classification: SafeClassification;
  /** Up to 3 raw tickets, returned to the browser and never stored. */
  tickets: unknown[];
  itemCount: number;
  hasNextPage: boolean;
  /** Up to 5 items of the first ticket's comments / history, when those are separate endpoints. */
  comments?: unknown[];
  history?: unknown[];
}

export async function sampleSource(session: OutboundSession, now = new Date()): Promise<Sample> {
  const { config, client } = session;
  try {
    const page = await fetchPage(client, ticketsEndpoint(config), START, updatedSinceVariable(config, now));
    const sample: Sample = { classification: "ok", tickets: page.items.slice(0, 3), itemCount: page.items.length, hasNextPage: page.next !== null };
    const first = page.items[0];
    const id = first === undefined ? null : safeId(config, first);
    if (id) {
      try {
        if (config.comments?.request) {
          const comments = await fetchPage(client, { request: config.comments.request, itemsPath: config.comments.itemsPath, pagination: config.comments.pagination }, START, { "ticket.id": id });
          sample.comments = comments.items.slice(0, 5);
        }
        if (config.statusHistory) {
          const history = await fetchPage(client, { request: config.statusHistory.request, itemsPath: config.statusHistory.itemsPath, pagination: config.statusHistory.pagination }, START, { "ticket.id": id });
          sample.history = history.items.slice(0, 5);
        }
      } catch {
        // Child endpoints are reported by the preview; the sample still returns the tickets.
      }
    }
    return sample;
  } catch (error) {
    logFailure("sample", error);
    if (error instanceof SourceStatusError) return { classification: classifyStatus(error.status), tickets: [], itemCount: 0, hasNextPage: false };
    return { classification: classifyError(error), tickets: [], itemCount: 0, hasNextPage: false };
  }
}

function safeId(config: CustomConfig, item: unknown): string | null {
  try {
    return evaluateText(config.mapping.id, item, envOf(config));
  } catch {
    return null;
  }
}

export interface PreviewTicket {
  externalId: string;
  subject: string | null;
  priority: string | null;
  closedAt: string | null;
  events: { type: string; occurredAt: string; actor: string }[];
}

export interface Preview {
  classification: SafeClassification;
  ticketsRead: number;
  tickets: PreviewTicket[];
  failures: { id: string; code: string; details?: MappingProblem[] }[];
  diagnostics: { id: string; code: string }[];
  deletedExternalIds: string[];
}

const PREVIEW_MAX_TICKETS = 25;

/**
 * Reads a small sample (up to two pages, 25 tickets), builds the raw events a
 * real run would store, and derives cases and events with the same pure
 * `deriveBatch` the worker uses. Nothing is written.
 */
export async function previewMapping(session: OutboundSession, now = new Date()): Promise<Preview> {
  const { config, client } = session;
  const empty = (classification: SafeClassification): Preview => ({ classification, ticketsRead: 0, tickets: [], failures: [], diagnostics: [], deletedExternalIds: [] });
  const rows: RawRow[] = [];
  const failures: { id: string; code: string; details?: MappingProblem[] }[] = [];
  let position: Position = START;
  let read = 0;
  try {
    for (let pages = 0; pages < 2 && read < PREVIEW_MAX_TICKETS; pages += 1) {
      const page = await fetchPage(client, ticketsEndpoint(config), position, updatedSinceVariable(config, now));
      for (const item of page.items) {
        if (read >= PREVIEW_MAX_TICKETS) break;
        read += 1;
        try {
          const built = await buildTicketEvents(client, config, item);
          for (const event of built.events) {
            rows.push({ id: `preview-${rows.length}`, providerEventId: event.providerEventId, payload: event.payload, fetchedAt: new Date(0) });
          }
        } catch (error) {
          if (!(error instanceof MappingError)) throw error;
          failures.push({ id: (safeId(config, item) ?? "unknown").slice(0, 64), code: error.code, ...(error.problems.length > 0 ? { details: error.problems } : {}) });
        }
      }
      if (page.next === null) break;
      position = page.next;
    }
  } catch (error) {
    logFailure("preview", error);
    if (error instanceof SourceStatusError) return empty(classifyStatus(error.status));
    return empty(classifyError(error));
  }
  const derived: DerivedBatch = deriveBatch(config, rows);
  const byId = new Map(derived.eventGroups.map((group) => [group.recordId, group]));
  return {
    classification: "ok",
    ticketsRead: read,
    tickets: derived.cases.map((facts) => ({
      externalId: facts.externalId,
      subject: facts.subject,
      priority: facts.priority,
      closedAt: facts.closedAt ? facts.closedAt.toISOString() : null,
      events: (byId.get(facts.externalId)?.events ?? []).map((e) => ({ type: e.type, occurredAt: e.occurredAt.toISOString(), actor: e.actor })),
    })),
    failures: [...failures, ...derived.failures.map((f) => ({ id: f.id, code: f.code, ...(f.details.length > 0 ? { details: f.details } : {}) }))],
    diagnostics: derived.diagnostics,
    deletedExternalIds: derived.deletedCaseExternalIds,
  };
}

export interface FullPassMeasurement {
  /** True when the whole listing, children included, ended inside one run's limits. */
  completed: boolean;
  pages: number;
  tickets: number;
  requests: number;
  seconds: number;
  /** Why it did not complete: `budget_exhausted`, `run_cap_reached`, or a safe classification. */
  stoppedBy: "budget_exhausted" | "run_cap_reached" | SafeClassification | null;
}

/**
 * The activation check for a source with no incremental cursor (plan 09, 4.3,
 * R6): performs the full listing under the same limits and budget as a real
 * run. Empirical, not an estimate. Uses a full 120 s budget, like a real run.
 */
export async function measureFullPass(config: CustomConfig, secrets: Record<string, string>): Promise<FullPassMeasurement> {
  const session = openOutboundSession(config, secrets, { totalMs: 120_000 });
  const { client, budget } = session;
  const started = budget.now();
  let pages = 0;
  let tickets = 0;
  const done = (completed: boolean, stoppedBy: FullPassMeasurement["stoppedBy"]): FullPassMeasurement => ({
    completed,
    pages,
    tickets,
    requests: budget.requests,
    seconds: Math.round((budget.now() - started) / 100) / 10,
    stoppedBy,
  });
  try {
    let position: Position = START;
    for (;;) {
      if (pages >= MAX_PAGES_PER_RUN || tickets >= MAX_TICKETS_PER_RUN) return done(false, "run_cap_reached");
      budget.assertCanStart();
      const page = await fetchPage(client, ticketsEndpoint(config), position, updatedSinceVariable(config, new Date()));
      for (const item of page.items) {
        try {
          await buildTicketEvents(client, config, item);
        } catch (error) {
          if (!(error instanceof MappingError)) throw error;
        }
      }
      pages += 1;
      tickets += page.items.length;
      if (page.next === null) return done(true, null);
      position = page.next;
    }
  } catch (error) {
    if (error instanceof SafeHttpError && (error.code === "budget_exhausted" || error.code === "run_cap_reached")) return done(false, error.code);
    if (error instanceof SourceStatusError) return done(false, classifyStatus(error.status));
    return done(false, classifyError(error));
  } finally {
    await session.dispose();
  }
}
