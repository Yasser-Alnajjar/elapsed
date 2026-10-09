import type { Prisma, PrismaClient } from "@sla/db";
import {
  IngestAbortedError,
  IntegrationNotConfiguredError,
  NormalizationAbortedError,
  PermissionDeniedError,
  ProviderUnavailableError,
  ReauthRequiredError,
  type CalendarImportResult,
  type CorrelationProjection,
  type IngestResult,
  type PolicyImportResult,
  type RecordFailureDetail,
  type ProjectionResult,
} from "@sla/ingestion";
import type { Logger } from "@sla/logger";

/**
 * Sync-run recording for every provider (N9.9; plan 09, 6.7 and 6.12). One
 * `IntegrationSyncRun` per integration attempt: counts, a fixed reason code for
 * every outcome other than `ok`, and record-level failures as `{recordId, code}`
 * with no payload text. D32: a successful run that changed no data and recorded
 * no failure is not stored (`isNoChangeRun`); every other run is.
 */
export type SyncOutcome = "ok" | "partial" | "failed" | "aborted";

export const MAX_RECORDED_FAILURES = 50;
export const SYNC_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DRAFT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const CODE = /^[a-z][a-z0-9_]{1,40}$/;

const MAX_FAILURE_DETAILS = 8;
const MAX_DETAIL_TEXT = 400;

/**
 * Field-level reasons for one failed record, kept to the fixed keys and bounded.
 * They are built from configuration and measured sizes by the adapter; the
 * clipping here is a backstop, not the safeguard.
 */
export function sanitizeFailureDetails(details: unknown): RecordFailureDetail[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const clean: RecordFailureDetail[] = [];
  for (const d of details.slice(0, MAX_FAILURE_DETAILS)) {
    const item = d as Partial<RecordFailureDetail> | null;
    if (!item || typeof item.message !== "string" || typeof item.mapping !== "string") continue;
    clean.push({
      mapping: item.mapping.slice(0, 80),
      target: String(item.target ?? "").slice(0, 80),
      reason: String(item.reason ?? "other").slice(0, 40),
      message: item.message.slice(0, MAX_DETAIL_TEXT),
      ...(typeof item.count === "number" ? { count: item.count } : {}),
    });
  }
  return clean.length > 0 ? clean : undefined;
}

/** A provider's own record error is free text and may hold source content; only a fixed snake_case code is kept. */
export function failureCode(error: string): string {
  return CODE.test(error) ? error : "processing_error";
}

/** A fixed, content-free code for an error. Never the message. */
export function reasonCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && CODE.test(code)) return code;
  if (error instanceof ReauthRequiredError) return "reauth_required";
  if (error instanceof PermissionDeniedError) return "permission_denied";
  if (error instanceof IntegrationNotConfiguredError) return "not_configured";
  if (error instanceof ProviderUnavailableError) return "provider_unavailable";
  return "error";
}

export interface RunFacts {
  ingestError: unknown | null;
  ingestResult: IngestResult | null;
  normalizeError: unknown | null;
  normalization: ProjectionResult | null;
  /** The rest of the DB-side pass; absent for a caller that has no such step. They only add to what counts as a change. */
  correlation?: CorrelationProjection | null;
  calendarImport?: CalendarImportResult | null;
  policyImport?: PolicyImportResult | null;
}

/**
 * Whether the run actually changed data (D32, plan 09 6.7), from before/after
 * comparisons and real writes, never from how many records were processed:
 * a case or customer created or changed, a case deleted, an event created or
 * deleted, a link created, reactivated, updated or unlinked, a calendar or
 * policy version created, a policy archived. A pass that threw reports nothing
 * (its projection result is lost), so it is not counted as a change here.
 */
export function dataChanged(facts: RunFacts): boolean {
  const n = facts.normalization;
  if (n && n.casesChanged + n.customersChanged + n.casesDeleted + n.eventsCreated + n.eventsDeleted > 0) return true;
  const c = facts.correlation;
  if (c && c.created + c.reactivated + c.updated + c.unlinked > 0) return true;
  if ((facts.calendarImport?.calendarVersionsCreated ?? 0) > 0) return true;
  const p = facts.policyImport;
  return (p?.policyVersionsCreated ?? 0) + (p?.policiesArchived ?? 0) > 0;
}

/** Record failures of the run: the ingest's own plus the projection's. */
export function failureCountOf(facts: RunFacts): number {
  const ingestFailures = facts.ingestResult?.syncRun?.recordFailures ?? [];
  return (facts.ingestResult?.syncRun?.recordFailureCount ?? ingestFailures.length) + (facts.normalization?.failures.length ?? 0);
}

/** D32: only a successful run that changed nothing and recorded no failure is left out of the history. */
export function isNoChangeRun(classified: Classified, facts: RunFacts): boolean {
  return classified.outcome === "ok" && !dataChanged(facts) && failureCountOf(facts) === 0;
}

export interface Classified {
  outcome: SyncOutcome;
  reasonCode: string | null;
  secondaryReason: string | null;
  /** True for the outcomes that must leave `lastSuccessfulSyncAt` and the failure counters alone. */
  leavesHealthAlone: boolean;
  /** True when the run counts as a successful sync (existing behavior). */
  success: boolean;
}

/**
 * Classifies one integration attempt in the order of plan 09, 6.12: a real
 * failure always wins (the budget cannot turn a failing provider into a
 * partial run), a guard abort is an abort, a `partial` marker with no error is
 * partial, everything else is ok. An ingest stopped on purpose (the Beta flag)
 * is `aborted` and touches no counters.
 */
export function classifyRun(facts: RunFacts): Classified {
  const partialReason = facts.ingestResult?.partial?.reason ?? null;
  const ingestAborted = facts.ingestError instanceof IngestAbortedError ? facts.ingestError : null;
  if (facts.ingestError && !ingestAborted) {
    return { outcome: "failed", reasonCode: reasonCodeOf(facts.ingestError), secondaryReason: null, leavesHealthAlone: false, success: false };
  }
  if (facts.normalizeError) {
    const aborted = facts.normalizeError instanceof NormalizationAbortedError;
    return {
      outcome: aborted ? "aborted" : "failed",
      reasonCode: aborted ? (facts.normalizeError as NormalizationAbortedError).code : reasonCodeOf(facts.normalizeError),
      secondaryReason: ingestAborted?.reason ?? partialReason,
      leavesHealthAlone: false,
      success: false,
    };
  }
  if (ingestAborted) return { outcome: "aborted", reasonCode: ingestAborted.reason, secondaryReason: null, leavesHealthAlone: true, success: false };
  if (partialReason) return { outcome: "partial", reasonCode: partialReason, secondaryReason: null, leavesHealthAlone: true, success: false };
  return { outcome: "ok", reasonCode: null, secondaryReason: null, leavesHealthAlone: false, success: true };
}

export async function recordSyncRun(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    integrationId: string;
    startedAt: Date;
    facts: RunFacts;
    classified: Classified;
    /** The time the worker also writes as `lastSuccessfulSyncAt`, so a later clean check is exactly comparable with this run (plan 09 6.12). */
    finishedAt?: Date;
    configVersion?: number | null;
    logger?: Logger;
  },
): Promise<boolean> {
  const { facts, classified } = input;
  if (isNoChangeRun(classified, facts)) return false;
  try {
    const ingestFailures = facts.ingestResult?.syncRun?.recordFailures ?? [];
    const normalizationFailures = (facts.normalization?.failures ?? []).map((f) => {
      const details = sanitizeFailureDetails(f.details);
      return { recordId: String(f.id).slice(0, 64), code: failureCode(f.error), ...(details ? { details } : {}) };
    });
    const failures = [...ingestFailures.map((f) => ({ ...f, ...(f.details ? { details: sanitizeFailureDetails(f.details) } : {}) })), ...normalizationFailures];
    const failureCount = failureCountOf(facts);
    const details = facts.normalizeError instanceof NormalizationAbortedError ? facts.normalizeError.details : null;
    const progress = {
      ...(facts.ingestResult?.partial?.progress ?? {}),
      ...(details ?? {}),
    };
    await prisma.integrationSyncRun.create({
      data: {
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? new Date(),
        trigger: "worker",
        outcome: classified.outcome,
        reasonCode: classified.reasonCode,
        secondaryReason: classified.secondaryReason,
        configVersion: input.configVersion ?? null,
        requests: facts.ingestResult?.syncRun?.requests ?? 0,
        bytes: Math.min(facts.ingestResult?.syncRun?.bytes ?? 0, 2_147_483_647),
        recordsFetched: facts.ingestResult?.recordsFetched ?? 0,
        casesWritten: facts.normalization?.casesChanged ?? 0,
        eventsWritten: facts.normalization?.eventsCreated ?? 0,
        deletions: facts.normalization?.casesDeleted ?? 0,
        failureCount,
        failures: failures.slice(0, MAX_RECORDED_FAILURES) as unknown as Prisma.InputJsonValue,
        progress: Object.keys(progress).length > 0 ? (progress as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (error) {
    // Recording history must never fail the cycle.
    input.logger?.warn("sync_run_record_failed", { integrationId: input.integrationId, error: error instanceof Error ? error.name : "error" });
    return false;
  }
  return true;
}

/** Retention: sync runs 30 days, expired custom drafts 14 days. Run by the reconciliation sweep, per organization. */
export async function pruneSyncHistory(prisma: PrismaClient, organizationId: string, now: Date): Promise<void> {
  await prisma.integrationSyncRun.deleteMany({ where: { organizationId, startedAt: { lt: new Date(now.getTime() - SYNC_RUN_RETENTION_MS) } } });
  await prisma.customProviderDraft.deleteMany({ where: { organizationId, expiresAt: { lt: now } } });
}
