import type { Prisma, PrismaClient } from "@sla/db";
import {
  IngestAbortedError,
  IntegrationNotConfiguredError,
  NormalizationAbortedError,
  PermissionDeniedError,
  ProviderUnavailableError,
  ReauthRequiredError,
  type IngestResult,
  type ProjectionResult,
} from "@sla/ingestion";
import type { Logger } from "@sla/logger";

/**
 * Sync-run recording for every provider (N9.9; plan 09, 6.7 and 6.12). One
 * `IntegrationSyncRun` per integration attempt: counts, a fixed reason code for
 * every outcome other than `ok`, and record-level failures as `{recordId, code}`
 * with no payload text. This only adds a write; it changes no existing
 * provider's behavior.
 */
export type SyncOutcome = "ok" | "partial" | "failed" | "aborted";

export const MAX_RECORDED_FAILURES = 50;
export const SYNC_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DRAFT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const CODE = /^[a-z][a-z0-9_]{1,40}$/;

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
    configVersion?: number | null;
    logger?: Logger;
  },
): Promise<void> {
  const { facts, classified } = input;
  try {
    const ingestFailures = facts.ingestResult?.syncRun?.recordFailures ?? [];
    const normalizationFailures = (facts.normalization?.failures ?? []).map((f) => ({ recordId: String(f.id).slice(0, 64), code: failureCode(f.error) }));
    const failures = [...ingestFailures, ...normalizationFailures];
    const failureCount = (facts.ingestResult?.syncRun?.recordFailureCount ?? ingestFailures.length) + normalizationFailures.length;
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
        finishedAt: new Date(),
        trigger: "worker",
        outcome: classified.outcome,
        reasonCode: classified.reasonCode,
        secondaryReason: classified.secondaryReason,
        configVersion: input.configVersion ?? null,
        requests: facts.ingestResult?.syncRun?.requests ?? 0,
        bytes: Math.min(facts.ingestResult?.syncRun?.bytes ?? 0, 2_147_483_647),
        recordsFetched: facts.ingestResult?.recordsFetched ?? 0,
        casesWritten: facts.normalization?.casesUpserted ?? 0,
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
  }
}

/** Retention: sync runs 30 days, expired custom drafts 14 days. Run by the reconciliation sweep, per organization. */
export async function pruneSyncHistory(prisma: PrismaClient, organizationId: string, now: Date): Promise<void> {
  await prisma.integrationSyncRun.deleteMany({ where: { organizationId, startedAt: { lt: new Date(now.getTime() - SYNC_RUN_RETENTION_MS) } } });
  await prisma.customProviderDraft.deleteMany({ where: { organizationId, expiresAt: { lt: now } } });
}
