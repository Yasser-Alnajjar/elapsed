import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@sla/db";
import { decryptCustomSecrets, CustomCredentialsUnreadableError, resolveIntegrationAvailability } from "@sla/db";
import {
  IngestAbortedError,
  IntegrationNotConfiguredError,
  PermissionDeniedError,
  ReauthRequiredError,
  type IngestContext,
  type IngestResult,
} from "@sla/ingestion";
import { registerSecretValues } from "@sla/logger";
import { RunBudget, SafeHttpError, createSafeHttpClient, privateHostsAllowed, type SafeHttpClient } from "@sla/safe-http";
import { CustomIngestError, SourceStatusError } from "./source-errors";
import { readCursor, type CustomCursor } from "./cursor";
import { atMapping, complete, kindOf, missingRequired } from "./diagnostics";
import { MappingError, type MappingProblem } from "./errors";
import { ChildTooLargeError, fetchAllItems, fetchPage, type Endpoint } from "./fetcher";
import { computeSourceHash } from "./hash";
import { MAX_STORED_PAYLOAD_BYTES, commentPaths, historyPaths, projectByPaths, ticketPaths } from "./projection";
import { START, type Position } from "./requests";
import { parseConfig, secretFieldNames, type AuthConfig, type CustomConfig } from "./schema";
import { envOf, RAW_PREFIX } from "./shared";
import { evaluateText } from "./transforms";
import { validateConfig } from "./validate";

export const MAX_PAGES_PER_RUN = 50;
export const MAX_TICKETS_PER_RUN = 5_000;
export const MAX_RECORD_FAILURES_REPORTED = 50;
export const ZERO_PROGRESS_LIMIT = 3;
const MAX_VERIFICATIONS_PER_RUN = 25;

export interface RawEventInput {
  providerEventId: string;
  sourceHash: string;
  payload: unknown;
}

/** The credentials JSON of a `custom` integration (plan 09, 9.3). */
export interface CustomCredentials {
  secrets: Record<string, string>;
  ticketUrlTemplate?: string | null;
  reauthRequired?: boolean;
}

export function authHeaders(auth: AuthConfig, secrets: Record<string, string>): Record<string, string> {
  switch (auth.type) {
    case "api_key_header":
      return { [auth.headerName]: secrets.apiKey! };
    case "bearer":
      return { authorization: `Bearer ${secrets.token!}` };
    case "basic":
      return { authorization: `Basic ${Buffer.from(`${secrets.username!}:${secrets.password!}`, "utf8").toString("base64")}` };
    case "custom_header":
      return { [auth.headerName]: `${auth.prefix ?? ""}${secrets.headerValue!}` };
  }
}

/** Every string that must never appear in a log, event or error while a run holds these credentials. */
export function sensitiveValues(headers: Record<string, string>, secrets: Record<string, string>): string[] {
  const values = new Set<string>([...Object.values(secrets), ...Object.values(headers)]);
  for (const value of Object.values(headers)) {
    const token = /^(?:Bearer|Basic)\s+(.+)$/.exec(value)?.[1];
    if (token) values.add(token);
  }
  return [...values].filter((value) => value.length > 0);
}

/** Hash of everything that decides what a listing request looks like; a change restarts an in-progress pass. */
export function listingHash(config: CustomConfig): string {
  return createHash("sha256")
    .update(JSON.stringify([config.connection.baseUrl, config.tickets, config.importWindowDays]))
    .digest("hex")
    .slice(0, 16);
}

function formatUpdatedSince(date: Date, format: "iso8601" | "epoch_seconds" | "epoch_millis"): string {
  if (format === "iso8601") return date.toISOString();
  return String(format === "epoch_seconds" ? Math.floor(date.getTime() / 1000) : date.getTime());
}

/** A stored raw event's payload is capped; a larger one fails its record and is never truncated. */
function assertPayloadSize(payload: unknown, what: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > MAX_STORED_PAYLOAD_BYTES) {
    throw new MappingError("payload_too_large", [
      complete(what, "payload_too_large", { reason: "too_long", length: bytes, max: MAX_STORED_PAYLOAD_BYTES, detail: `the data kept for this record is ${bytes} bytes; maximum allowed is ${MAX_STORED_PAYLOAD_BYTES}. Map fewer or smaller fields.` }),
    ]);
  }
}

export interface TicketRawEvents {
  ticketId: string;
  events: RawEventInput[];
}

/**
 * Turns one listed ticket (and its separately fetched comments and history)
 * into raw events. Throws a `MappingError` (the record fails; its events are
 * withheld, all or nothing) or lets a `SafeHttpError`/`SourceStatusError`
 * through (a real failure or budget stop).
 */
export async function buildTicketEvents(client: SafeHttpClient, config: CustomConfig, item: unknown): Promise<TicketRawEvents> {
  const env = envOf(config);
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    const kind = kindOf(item);
    throw new MappingError("invalid_type", [
      complete("tickets.itemsPath", "invalid_type", {
        reason: "unsupported_type",
        source: config.tickets.itemsPath,
        actualType: kind,
        detail: `an item found at "${config.tickets.itemsPath}" is ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}; expected an object. Check where the tickets are in the response.`,
      }),
    ]);
  }
  const ticketId = atMapping("mapping.id", () => evaluateText(config.mapping.id, item, env));
  if (ticketId === null) missingRequired("mapping.id", config.mapping.id, item);
  if (ticketId.length > 256 || /[\u0000-\u001f]/.test(ticketId)) {
    throw new MappingError("unsafe_id", [
      complete("mapping.id", "unsafe_id", {
        reason: "other",
        length: ticketId.length,
        max: 256,
        detail: ticketId.length > 256 ? `ticket ID is ${ticketId.length} characters long; maximum allowed is 256.` : "ticket ID contains control characters.",
      }),
    ]);
  }

  const projection = projectByPaths(item, ticketPaths(config));
  assertPayloadSize(projection, "mapping");
  const events: RawEventInput[] = [];
  const hash = computeSourceHash(projection);
  events.push({ providerEventId: `${RAW_PREFIX.ticket}${ticketId}:${hash}`, sourceHash: hash, payload: projection });

  // A child request for a ticket that has since been deleted is a record failure, not a failed run.
  const children = async (endpoint: Endpoint, notFound: "comments_not_found" | "history_not_found"): Promise<unknown[]> => {
    const where = notFound === "comments_not_found" ? "comments.request" : "statusHistory.request";
    try {
      return await fetchAllItems(client, endpoint, { "ticket.id": ticketId });
    } catch (error) {
      if (error instanceof SourceStatusError && error.status === 404) {
        const what = notFound === "comments_not_found" ? "comments" : "status history";
        throw new MappingError(notFound, [
          complete(where, notFound, {
            reason: "other",
            source: endpoint.request.path,
            detail: `${endpoint.request.method} ${endpoint.request.path} answered 404 (not found) for this ticket's ${what}. Check the path, or the ticket was deleted.`,
          }),
        ], { cause: error });
      }
      if (error instanceof ChildTooLargeError) {
        throw new MappingError("payload_too_large", [
          complete(where, "payload_too_large", { reason: "too_long", detail: `${endpoint.request.path} returned more pages or data than one ticket may have.` }),
        ], { cause: error });
      }
      throw error;
    }
  };

  if (config.comments?.request && config.commentMapping) {
    const endpoint: Endpoint = { request: config.comments.request, itemsPath: config.comments.itemsPath, pagination: config.comments.pagination };
    const paths = commentPaths(config);
    for (const comment of await children(endpoint, "comments_not_found")) {
      const commentId = atMapping("commentMapping.id", () => evaluateText(config.commentMapping!.id, comment, env));
      if (commentId === null) missingRequired("commentMapping.id", config.commentMapping.id, comment);
      const body = { t: ticketId, i: projectByPaths(comment, paths) };
      assertPayloadSize(body, "comments.request");
      const commentHash = computeSourceHash(body);
      events.push({ providerEventId: `${RAW_PREFIX.comment}${ticketId}:${commentId}:${commentHash}`, sourceHash: commentHash, payload: body });
    }
  }
  if (config.statusHistory) {
    const endpoint: Endpoint = { request: config.statusHistory.request, itemsPath: config.statusHistory.itemsPath, pagination: config.statusHistory.pagination };
    const paths = historyPaths(config);
    let index = 0;
    for (const entry of await children(endpoint, "history_not_found")) {
      const entryId = (config.statusHistory.mapping.id ? atMapping("statusHistory.mapping.id", () => evaluateText(config.statusHistory!.mapping.id!, entry, env)) : null) ?? String(index);
      index += 1;
      const body = { t: ticketId, i: projectByPaths(entry, paths) };
      assertPayloadSize(body, "statusHistory.request");
      const entryHash = computeSourceHash(body);
      events.push({ providerEventId: `${RAW_PREFIX.history}${ticketId}:${entryId}:${entryHash}`, sourceHash: entryHash, payload: body });
    }
  }
  return { ticketId, events };
}

interface RunState {
  pages: number;
  tickets: number;
  recordsStored: number;
  failures: { recordId: string; code: string; details?: MappingProblem[] }[];
  failureCount: number;
}

const MAX_DETAILS_PER_FAILURE = 8;

function endpointOf(config: CustomConfig): Endpoint {
  return { request: config.tickets.request, itemsPath: config.tickets.itemsPath, pagination: config.tickets.pagination };
}

/** What a failed request means for the run. 401/403 keep their lifecycle; anything else is a failed run with a fixed code. */
function classifyFailure(error: unknown): Error {
  if (error instanceof SourceStatusError) {
    if (error.status === 401) return new ReauthRequiredError("Credentials were rejected by the source");
    if (error.status === 403) return new PermissionDeniedError("The source denied access");
    return new CustomIngestError(error.status === 429 ? "rate_limited" : error.status >= 500 ? "provider_unavailable" : `status_${error.status}`);
  }
  if (error instanceof SafeHttpError) return new CustomIngestError(error.code);
  if (error instanceof CustomCredentialsUnreadableError) {
    return Object.assign(new ReauthRequiredError("Credentials unavailable; enter them again"), { code: "credentials_unreadable" });
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * One ingest run for a `custom` integration (plan 09, 6.1 to 6.3, 6.12, 8.7).
 *
 * - Page-atomic: a page's raw events and the cursor commit together, so a
 *   stop or crash leaves either the whole page or none of it.
 * - Bounded: 120 s total budget, 50 pages and 5,000 tickets per run. Running
 *   out of any of them ends the run `partial` at the last completed page;
 *   a real failure (provider, transport, auth) is thrown and keeps the
 *   failure policy, even when the budget also ran out while retrying it.
 * - Platform availability (the Beta allowlist, D33) is checked before the run, before each attempt and every few
 *   seconds while a request is on the wire.
 */
export async function runCustomIngest(ctx: IngestContext): Promise<IngestResult> {
  const { prisma, integration } = ctx;
  const row = await prisma.integration.findUniqueOrThrow({
    where: { id: integration.id },
    select: {
      credentials: true,
      cursor: true,
      activeConfigVersion: true,
    },
  });
  // Platform availability (D33): a disabled provider, or an organization off the
  // Custom REST allowlist, makes no request. The worker already skips an
  // unavailable integration before calling `ingest`; this keeps the adapter
  // safe on its own.
  if (!(await resolveIntegrationAvailability(prisma, integration.organizationId, "custom")).available || row.activeConfigVersion === null) {
    throw new IntegrationNotConfiguredError("Custom");
  }

  const versionRow = await prisma.customProviderConfigVersion.findUnique({
    where: { integrationId_version: { integrationId: integration.id, version: row.activeConfigVersion } },
    select: { config: true },
  });
  const parsed = versionRow ? parseConfig(versionRow.config) : null;
  if (!parsed || !parsed.ok) throw new CustomIngestError("config_invalid");
  const config = parsed.config;
  if (!validateConfig(config, { allowPrivateHosts: privateHostsAllowed() }).ok) throw new CustomIngestError("config_invalid");

  let secrets: Record<string, string>;
  try {
    const stored = (row.credentials as CustomCredentials | null)?.secrets;
    secrets = decryptCustomSecrets(stored, { organizationId: integration.organizationId, integrationId: integration.id }, secretFieldNames(config.auth));
  } catch (error) {
    throw classifyFailure(error);
  }
  const headers = authHeaders(config.auth, secrets);
  const sensitive = sensitiveValues(headers, secrets);
  const unregister = registerSecretValues(sensitive);

  // Re-checked before each attempt and every ~5 s while a request is in flight
  // (plan 09 §8.7): turning the provider off, or removing the organization from
  // its allowlist, aborts the request and discards the response (D33).
  const checkStop = async (): Promise<string | null> => {
    const decision = await resolveIntegrationAvailability(prisma, integration.organizationId, "custom");
    return decision.available ? null : "flag_disabled";
  };
  const budget = new RunBudget({ checkStop });
  const client = createSafeHttpClient({
    baseUrl: config.connection.baseUrl,
    budget,
    headers,
    secretValues: Object.values(secrets),
    destination: { allowPrivateHosts: privateHostsAllowed() },
  });

  try {
    return await ingestPasses(prisma, ctx, config, client, budget, readCursor(row.cursor));
  } catch (error) {
    if (error instanceof SafeHttpError && error.code === "stopped") throw new IngestAbortedError(error.reason ?? "stopped");
    throw classifyFailure(error);
  } finally {
    await client.close();
    unregister();
  }
}

async function ingestPasses(
  prisma: PrismaClient,
  ctx: IngestContext,
  config: CustomConfig,
  client: SafeHttpClient,
  budget: RunBudget,
  initial: CustomCursor,
): Promise<IngestResult> {
  const { integration } = ctx;
  const state: RunState = { pages: 0, tickets: 0, recordsStored: 0, failures: [], failureCount: 0 };
  const endpoint = endpointOf(config);
  const hash = listingHash(config);
  const incremental = config.tickets.incremental;
  const env = envOf(config);
  const cursor: CustomCursor = { ...initial, v: 1 };

  if (cursor.listingHash !== hash) {
    cursor.listing = null;
    cursor.listingHash = hash;
  }
  const verifyDeletions = Boolean(config.deletion?.verifyWithDetail && config.ticketDetail && !incremental);

  const persist = async (events: RawEventInput[]): Promise<void> => {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (events.length > 0) {
      ops.push(
        prisma.rawEvent.createMany({
          data: events.map((event) => ({
            integrationId: integration.id,
            providerEventId: event.providerEventId,
            sourceHash: event.sourceHash,
            payload: event.payload as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        }),
      );
    }
    ops.push(prisma.integration.update({ where: { id: integration.id }, data: { cursor: cursor as unknown as Prisma.InputJsonValue } }));
    await prisma.$transaction(ops);
  };

  const result = (partial?: IngestResult["partial"]): IngestResult => ({
    recordsFetched: state.tickets,
    counts: { tickets: state.tickets, pages: state.pages, rawEvents: state.recordsStored },
    ...(partial ? { partial } : {}),
    syncRun: {
      requests: budget.requests,
      bytes: budget.bytesRead,
      recordFailures: state.failures.slice(0, MAX_RECORD_FAILURES_REPORTED),
      recordFailureCount: state.failureCount,
    },
  });

  const finishPartial = async (reason: "budget_exhausted" | "run_cap_reached"): Promise<IngestResult> => {
    // Zero progress three runs in a row can never finish: the next such run is a failure (U5).
    if (state.pages === 0) {
      const runs = (cursor.zeroProgressRuns ?? 0) + 1;
      if ((cursor.zeroProgressRuns ?? 0) >= ZERO_PROGRESS_LIMIT) {
        cursor.zeroProgressRuns = 0;
        await persist([]);
        throw new CustomIngestError("no_progress");
      }
      cursor.zeroProgressRuns = runs;
      await persist([]);
    }
    return result({
      reason,
      progress: {
        pagesCompleted: state.pages,
        ticketsRead: state.tickets,
        listingPages: cursor.listing?.pages ?? 0,
        listingTickets: cursor.listing?.tickets ?? 0,
        initialImportRunning: !cursor.backfillCompletedAt,
        hasIncrementalCursor: Boolean(incremental),
      },
    });
  };

  const stopsRun = (error: unknown): "budget_exhausted" | "run_cap_reached" | null => {
    if (error instanceof SafeHttpError && error.code === "budget_exhausted") return "budget_exhausted";
    if (error instanceof SafeHttpError && error.code === "run_cap_reached") return "run_cap_reached";
    return null;
  };

  // ---- start or resume a pass ------------------------------------------------
  const now = new Date();
  if (!cursor.listing) {
    const watermark = cursor.watermark ? new Date(cursor.watermark) : new Date(now.getTime() - config.importWindowDays * 86_400_000);
    cursor.listing = {
      anchor: now.toISOString(),
      updatedSince: incremental ? watermark.toISOString() : null,
      position: START,
      pages: 0,
      tickets: 0,
      ...(verifyDeletions ? { seenIds: [] } : {}),
    };
  }
  const listing = cursor.listing;

  for (;;) {
    if (state.pages >= MAX_PAGES_PER_RUN || state.tickets >= MAX_TICKETS_PER_RUN) return finishPartial("run_cap_reached");

    let next: Position | null;
    const pageEvents: RawEventInput[] = [];
    const pageFailures: { recordId: string; code: string; details?: MappingProblem[] }[] = [];
    let pageTickets = 0;
    const seen: string[] = [];
    try {
      budget.assertCanStart();
      await budget.assertNotStopped();
      const page = await fetchPage(client, endpoint, listing.position, {
        ...(listing.updatedSince && incremental ? { updatedSince: formatUpdatedSince(new Date(listing.updatedSince), incremental.format) } : {}),
      });
      const idsThisPage = new Set<string>();
      for (const item of page.items) {
        pageTickets += 1;
        try {
          const built = await buildTicketEvents(client, config, item);
          if (idsThisPage.has(built.ticketId)) {
            throw new MappingError("duplicate_id", [complete("mapping.id", "duplicate_id", { reason: "other", detail: "another ticket on the same page has this ID. Check that the ID field is unique per ticket." })]);
          }
          idsThisPage.add(built.ticketId);
          pageEvents.push(...built.events);
          seen.push(built.ticketId);
        } catch (error) {
          if (!(error instanceof MappingError)) throw error;
          const recordId = (() => {
            try {
              return evaluateText(config.mapping.id, item, env) ?? "unknown";
            } catch {
              return "unknown";
            }
          })();
          pageFailures.push({ recordId: recordId.slice(0, 64), code: error.code, ...(error.problems.length > 0 ? { details: error.problems.slice(0, MAX_DETAILS_PER_FAILURE) } : {}) });
        }
      }
      next = page.next;
    } catch (error) {
      const reason = stopsRun(error);
      if (reason) return finishPartial(reason);
      throw error;
    }

    // The page completed (listing request and every child request): commit it with the cursor.
    listing.pages += 1;
    listing.tickets += pageTickets;
    if (listing.seenIds) listing.seenIds.push(...seen);
    if (next) listing.position = next;
    cursor.zeroProgressRuns = 0;
    if (!next) {
      // The pass is complete: advance the watermark only now (plan 09, 6.12).
      if (incremental) {
        const previous = cursor.watermark ? new Date(cursor.watermark).getTime() : 0;
        const advanced = Math.max(previous, new Date(listing.anchor).getTime() - incremental.lookbackSeconds * 1000);
        cursor.watermark = new Date(advanced).toISOString();
      }
      cursor.backfillCompletedAt = cursor.backfillCompletedAt ?? new Date().toISOString();
      cursor.lastPassCompletedAt = new Date().toISOString();
      if (verifyDeletions && listing.seenIds && listing.tickets > 0) {
        const seenIds = new Set(listing.seenIds);
        const live = await prisma.case.findMany({
          where: { organizationId: integration.organizationId, sourceIntegrationId: integration.id, deletedAt: null },
          select: { externalId: true },
        });
        cursor.pendingVerification = live.map((c) => c.externalId).filter((id) => !seenIds.has(id));
      }
      cursor.listing = null;
    }
    await persist(pageEvents);
    state.pages += 1;
    state.tickets += pageTickets;
    state.recordsStored += pageEvents.length;
    state.failureCount += pageFailures.length;
    state.failures.push(...pageFailures);
    if (!next) break;
  }

  // ---- verified-404 deletion checks (bounded; the rest wait for the next run) ----
  if (verifyDeletions && cursor.pendingVerification && cursor.pendingVerification.length > 0 && config.ticketDetail) {
    const detail: Endpoint = { request: config.ticketDetail.request, itemsPath: "$", pagination: { type: "none" } };
    const batch = cursor.pendingVerification.slice(0, MAX_VERIFICATIONS_PER_RUN);
    const deleted: RawEventInput[] = [];
    let checked = 0;
    try {
      for (const id of batch) {
        budget.assertCanStart();
        await budget.assertNotStopped();
        try {
          await fetchPage(client, detail, START, { "ticket.id": id });
        } catch (error) {
          if (error instanceof SourceStatusError && error.status === 404) {
            const body = { t: id };
            const eventHash = computeSourceHash(body);
            deleted.push({ providerEventId: `${RAW_PREFIX.deleted}${id}:${eventHash}`, sourceHash: eventHash, payload: body });
          } else if (error instanceof SourceStatusError && error.status !== 401 && error.status !== 403) {
            // Any other status proves nothing: leave the ticket alone.
          } else throw error;
        }
        checked += 1;
      }
    } catch (error) {
      if (!stopsRun(error)) throw error;
    }
    cursor.pendingVerification = cursor.pendingVerification.slice(checked);
    await persist(deleted);
    state.recordsStored += deleted.length;
  }
  return result();
}
