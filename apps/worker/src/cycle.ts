import {
  ensureDefaultCalendarVersion,
  loadPolicyContext,
  runCommitmentPipeline,
  runCommitmentReResolutionPipeline,
  runEvaluationPipeline,
  runNextReplyCyclePipeline,
  type EvaluationPipelineResult,
  type EvaluationScope,
} from "@sla/commitments";
import {
  getIntegrationConfig,
  isConfigurableIntegrationProvider,
  recordSlaImportSummary,
  resolveOrganizationAvailability,
  withOrganizationSlaLock,
  withPerfScope,
  type IntegrationAvailabilityDecision,
  type IntegrationProvider,
  type PrismaClient,
} from "@sla/db";
import type { SourceRole } from "@sla/core";
import {
  IngestAbortedError,
  IntegrationNotConfiguredError,
  PermissionDeniedError,
  ReauthRequiredError,
  syncIntegration,
  type IngestResult,
  type IntegrationRef,
  type IntegrationSyncResult,
  type PolicyImportResult,
  type ProjectionResult,
} from "@sla/ingestion";
import { createLogger, type Logger } from "@sla/logger";
import {
  claimNotifications,
  deliverClaimedNotifications,
  deliverMonthlyReport,
  deliverTrialExpiryNotice,
  type NotificationClaims,
} from "@sla/notifications";
import { caseRefResolverFor } from "./case-ref";
import { forEachWithConcurrency, normalizeConcurrency } from "./concurrency";
import type { WorkerConfig } from "./config";
import { LeaseLostError, type LeaseGuard } from "./lease";
import { ISSUE_LINK_PROVIDERS, PROVIDERS } from "./providers";
import { captureException } from "./sentry";
import { classifyRun, dataChanged, pruneSyncHistory, recordSyncRun } from "./sync-runs";

export type CycleKind = "active_set_poll" | "reconciliation_sweep";

/**
 * How far back the active-set poll looks for cases with new events to
 * re-derive Next Reply cycles for, as a multiple of the poll interval (so a
 * missed or slow tick still overlaps the next one), never under the floor.
 * Anything older is the reconciliation sweep's job.
 */
const ACTIVE_LOOKBACK_INTERVALS = 3;
const ACTIVE_LOOKBACK_FLOOR_MS = 15 * 60 * 1000;
const DEFAULT_ACTIVE_POLL_MS = 5 * 60 * 1000;

export function emptyCycleResult(kind: CycleKind): CycleResult {
  return {
    kind,
    organizationsProcessed: 0,
    commitmentsCreated: 0,
    commitmentsReResolved: 0,
    cyclesCreated: 0,
    cyclesCancelled: 0,
    cyclesRestored: 0,
    commitmentsConsidered: 0,
    evaluationsCreated: 0,
    commitmentsFinalized: 0,
    notificationsSent: 0,
    failures: [],
    integrationIssues: [],
    skipped: [],
  };
}

export interface CycleResult {
  kind: CycleKind;
  organizationsProcessed: number;
  commitmentsCreated: number;
  commitmentsReResolved: number;
  cyclesCreated: number;
  cyclesCancelled: number;
  cyclesRestored: number;
  commitmentsConsidered: number;
  evaluationsCreated: number;
  commitmentsFinalized: number;
  notificationsSent: number;
  /**
   * Worker-execution failures: something the worker itself or a configured
   * provider got wrong (timeouts, 5xx, rate limits, malformed data, stage
   * errors). These — and only these — make a run "failed" and feed the
   * worker's Degraded status.
   */
  failures: { organizationId: string; stage: string; error: string }[];
  /**
   * Integrations the worker could not sync because of the customer's side:
   * reconnect needed (`reauth_required`) or provider access lost
   * (`permission_denied`). Already surfaced on the Integration itself
   * (status + lastSyncError) and logged; not a worker failure.
   */
  integrationIssues: { organizationId: string; provider: string; issue: "reauth_required" | "permission_denied"; message: string }[];
  /** Integrations skipped because the organization has not configured them. */
  skipped: { organizationId: string; provider: string; reason: string }[];
}

/**
 * The evaluation scope is what separates the two speeds. Ingestion itself is
 * the same call in both: the provider adapters fetch incrementally from the
 * cursor persisted on `Integration`, so a five-minute cycle naturally pulls
 * only what changed in those five minutes, and the reconciliation sweep re-runs the
 * identical call as a safety net — if an active-set cycle failed or was
 * delayed, the cursor is still behind and the sweep catches it up.
 */
const SCOPE_BY_KIND: Record<CycleKind, EvaluationScope> = {
  active_set_poll: "active",
  reconciliation_sweep: "all",
};

/**
 * Within one organization, ticket sources go first (they create the cases
 * everything else attaches to), then work trackers (they link onto those
 * cases), then code hosts (GitHub's correlator links transitively through the
 * trackers' links — see packages/github/src/correlate.ts). A miss just
 * self-heals on the next poll either way (upsert-based), but same-cycle
 * ordering avoids an unnecessary extra cycle's delay.
 */
const ROLE_CYCLE_ORDER: Record<SourceRole, number> = { ticket_source: 0, work_tracker: 1, code_host: 2 };

/** What `processOrganization` needs to know about the organization it is given. */
export interface OrganizationToProcess {
  id: string;
  integrations: {
    id: string;
    provider: IntegrationProvider;
    credentials: unknown;
    status: string;
    failingSince: Date | null;
    /** Set by a platform operator (N4.5): skip the provider fetch while set. */
    pollingPausedAt?: Date | null;
    /** Set by a platform operator (N4.5): run one full normalization pass, then clear. */
    renormalizeRequestedAt?: Date | null;
  }[];
}

/**
 * The Prisma `select` both callers (the whole-deployment `runCycle` and the
 * per-organization work loop) use to load an organization for processing.
 * Disconnected integrations keep their row (never deleted — see the
 * Integration model's doc comment) but have no credentials left to ingest
 * with, so processing must not touch them.
 */
export const ORGANIZATION_TO_PROCESS_SELECT = {
  id: true,
  integrations: {
    where: { status: { not: "disconnected" as const } },
    select: {
      id: true,
      provider: true,
      credentials: true,
      status: true,
      failingSince: true,
      pollingPausedAt: true,
      renormalizeRequestedAt: true,
    },
  },
} as const;

export interface OrganizationRunContext {
  kind: CycleKind;
  /** Carries the run's id (`cycleId`); each organization gets a `.child({ organizationId })`. */
  logger: Logger;
  /** Accumulates this run's counters and failures. `processOrganization` only mutates it with synchronous `+=`/`push`, so organizations sharing one result can't interleave updates. */
  result: CycleResult;
  /** The configured active-poll interval — sizes the poll's "new events" lookback. */
  activePollMs?: number;
  /** The operator kill switch for the monthly customer report (N5.6), read when a reconciliation run reaches it. Absent: on. */
  monthlyReportEnabled?: () => Promise<boolean>;
  /** The operator switch for plan entitlements (N6), read when a reconciliation run reaches the trial check. Absent: off. */
  entitlementsEnforced?: () => Promise<boolean>;
  /** Log label only, e.g. "3/10". */
  position: string;
  /** Organizations being processed right now (log label only). */
  inFlight: () => number;
  /**
   * The lease this run is executing under, when there is one (the work loop;
   * absent for `runCycle`). Checked before each stage that publishes results,
   * so a worker that lost its organization stops instead of writing stale
   * state — see `lease.ts`.
   */
  lease?: LeaseGuard;
}

/**
 * Processes one organization end to end: ingest every connected integration,
 * then — under the organization's advisory lock — normalize, run the
 * commitment/cycle/evaluation pipelines and claim notifications, then deliver
 * them. Failures are recorded on `ctx.result` per stage rather than thrown,
 * so one broken integration never stops the rest. The one thing it does
 * throw is `LeaseLostError` (from `ctx.lease`): losing the lease is not a
 * stage failure, it means this worker no longer owns the organization.
 */
export async function processOrganization(
  prisma: PrismaClient,
  config: WorkerConfig,
  organization: OrganizationToProcess,
  ctx: OrganizationRunContext,
): Promise<void> {
  const { kind, result, position, lease } = ctx;
  result.organizationsProcessed += 1;
  const orgLogger = ctx.logger.child({ organizationId: organization.id });
  const orgStartedAt = Date.now();
  orgLogger.info("organization_started", {
    position,
    integrations: organization.integrations.length,
    organizationsInFlight: ctx.inFlight(),
  });

  const orderedIntegrations = [...organization.integrations].sort(
    (a, b) => ROLE_CYCLE_ORDER[PROVIDERS[a.provider].role] - ROLE_CYCLE_ORDER[PROVIDERS[b.provider].role],
  );
  const integrationRef = (integration: OrganizationToProcess["integrations"][number]): IntegrationRef => ({
    id: integration.id,
    organizationId: organization.id,
    provider: integration.provider,
    status: integration.status as IntegrationRef["status"],
  });

  // Phase 1: ingest only (network-bound, idempotent RawEvent upserts) —
  // deliberately outside the per-organization lock below, so a slow
  // provider fetch never makes a concurrent webhook delivery for this
  // organization wait on it.
  const ingestOutcomes = new Map<
    string,
    {
      syncError: string | null;
      reauthRequired: boolean;
      permissionDenied: boolean;
      durationMs: number;
      /** Ingest was skipped on purpose (operator pause, or the provider is unavailable to this organization, D33): no sync attempt happened, so none is recorded. */
      paused: boolean;
      /** What the sync-run record (N9.9) is built from. */
      startedAt: Date;
      ingestError: unknown | null;
      ingestResult: IngestResult | null;
    }
  >();

  // Platform availability (D33, plan 10 §5.3), read fresh for every
  // organization run so an operator's change applies to the next run in every
  // worker. If it cannot be read, no provider is called this run (fail closed):
  // the stored-data stages below still run.
  let availability: Record<IntegrationProvider, IntegrationAvailabilityDecision> | null = null;
  try {
    availability = await resolveOrganizationAvailability(prisma, organization.id);
  } catch (error) {
    result.failures.push({
      organizationId: organization.id,
      stage: "availability",
      error: error instanceof Error ? error.message : String(error),
    });
    captureException(error, { organizationId: organization.id, kind, stage: "availability" });
  }

  const skipIngest = (integration: OrganizationToProcess["integrations"][number]) =>
    ingestOutcomes.set(integration.id, {
      syncError: null,
      reauthRequired: false,
      permissionDenied: false,
      durationMs: 0,
      paused: true,
      startedAt: new Date(),
      ingestError: null,
      ingestResult: null,
    });

  for (const integration of orderedIntegrations) {
    // Outside the try below on purpose: losing the lease must abort the run,
    // not be recorded as this integration's sync error. Each provider call
    // advances the integration's cursor, so this is the gate that keeps a
    // worker that lost the organization from ingesting it.
    lease?.assertValid();
    const decision = availability?.[integration.provider];
    if (!decision?.available) {
      // Unavailable to this organization (D33): disabled, Coming Soon, or Beta
      // without this organization on the allowlist. Treated exactly like an
      // operator pause: no provider call, no sync attempt, no failure and no
      // "failing since" streak. `Integration.status` is never touched, so it
      // stays distinct from a customer's disconnect. Stored data keeps being
      // normalized and evaluated below; the source goes stale (D22).
      orgLogger.info("integration_ingest_unavailable", {
        position,
        provider: integration.provider,
        integrationId: integration.id,
        reason: decision && !decision.available ? decision.code : "availability_unknown",
      });
      skipIngest(integration);
      continue;
    }
    if (integration.pollingPausedAt) {
      // Paused by a platform operator (N4.5): no provider fetch. Not a failure
      // and not a sync attempt, so no sync health is written for it below;
      // `lastSuccessfulSyncAt` therefore stops advancing and the integration
      // goes stale, which is exactly what the customer should be told.
      // Normalization and evaluation still run on the events already stored.
      orgLogger.info("integration_ingest_paused", {
        position,
        provider: integration.provider,
        integrationId: integration.id,
        pausedAt: integration.pollingPausedAt.toISOString(),
      });
      skipIngest(integration);
      continue;
    }
    const integrationStartedAt = Date.now();
    let syncError: string | null = null;
    let reauthRequired = false;
    let permissionDenied = false;
    let skipped = false;
    let ingestError: unknown | null = null;
    let ingestResult: IngestResult | null = null;
    const attemptStartedAt = new Date();
    const providerLabel = `${integration.provider[0]!.toUpperCase()}${integration.provider.slice(1)}`;

    try {
      ingestResult = await PROVIDERS[integration.provider].ingest({
        prisma,
        integration: integrationRef(integration),
        logger: orgLogger.child({ integrationId: integration.id, provider: integration.provider }),
        appUrl: config.appUrl ?? null,
        loadOAuthConfig: () =>
          isConfigurableIntegrationProvider(integration.provider)
            ? getIntegrationConfig(prisma, organization.id, integration.provider)
            : Promise.resolve(null), // `custom` has no OAuth app
      });
    } catch (error) {
      // Not a sync failure: this worker no longer owns the organization (its
      // cursor write was fenced out). Stop the run rather than record it.
      if (error instanceof LeaseLostError) throw error;
      // Every path here — not configured, an undecryptable config
      // (IntegrationConfigUnreadableError, W5), a reauth requirement, or a
      // provider sync failure — lands one diagnostic entry instead of a
      // silent `continue`, so a misconfigured or disconnected-at-the-config
      // level integration shows up the same way a failed sync does, both
      // in `result.failures` and on `Integration.lastSyncError`.
      ingestError = error;
      if (error instanceof IngestAbortedError) {
        // Stopped on purpose (the operator turned the Beta flag off): not a failure, nothing was written from the unfinished page (N9, Q5).
        orgLogger.info("integration_ingest_aborted", {
          position,
          provider: integration.provider,
          integrationId: integration.id,
          reason: error.reason,
        });
      } else {
        reauthRequired = error instanceof ReauthRequiredError;
        // A 403 (roadmap step 32): the token works but the connecting user
        // lost access provider-side — surfaced as its own status, since the
        // fix is restoring that user's permissions, not reconnecting.
        permissionDenied = !reauthRequired && error instanceof PermissionDeniedError;
        syncError = reauthRequired
          ? `${providerLabel} needs to be reconnected`
          : permissionDenied
            ? `${providerLabel} denied access — the connecting user's ${providerLabel} permissions may have changed`
            : error instanceof Error
              ? error.message
              : String(error);
        if (error instanceof IntegrationNotConfiguredError) {
          // Nothing to ingest: skip this integration, keep going. The message
          // still lands on Integration.lastSyncError so the settings page can
          // show why, but it is not a failure of this run.
          skipped = true;
          result.skipped.push({ organizationId: organization.id, provider: integration.provider, reason: syncError });
          orgLogger.info("integration_skipped", {
            position,
            provider: integration.provider,
            integrationId: integration.id,
            reason: syncError,
          });
        } else if (reauthRequired || permissionDenied) {
          // The customer's integration needs attention (reconnect, or restore
          // the connecting user's provider permissions). That is integration
          // health, recorded on the Integration below and logged here — not a
          // failure of the worker, so it stays out of `failures`.
          result.integrationIssues.push({
            organizationId: organization.id,
            provider: integration.provider,
            issue: reauthRequired ? "reauth_required" : "permission_denied",
            message: syncError,
          });
          orgLogger.warn("integration_needs_attention", {
            position,
            provider: integration.provider,
            integrationId: integration.id,
            issue: reauthRequired ? "reauth_required" : "permission_denied",
            message: syncError,
          });
        } else {
          result.failures.push({
            organizationId: organization.id,
            stage: `ingest:${integration.provider}`,
            error: syncError,
          });
        }
        // Reauth is an expected, already-surfaced state (the settings page's
        // ReauthBanner) — not a bug — so it's excluded here to keep Sentry
        // for actual failures worth investigating, not routine reauth churn.
        // Permission loss is reported once, on the transition into
        // `permission_denied`: the operator should hear about it, but not
        // again on every cycle until the customer fixes it. A skipped,
        // unconfigured integration is expected and never reported.
        if (
          !skipped &&
          !reauthRequired &&
          !(permissionDenied && integration.status === "permission_denied")
        ) {
          captureException(error, {
            organizationId: organization.id,
            integrationId: integration.id,
            provider: integration.provider,
            kind,
            stage: "ingest",
          });
        }
      }
    }

    orgLogger.info("integration_ingested", {
      position,
      provider: integration.provider,
      integrationId: integration.id,
      durationMs: Date.now() - integrationStartedAt,
      ok: syncError === null,
      outcome: skipped
        ? "skipped"
        : syncError === null
          ? "ok"
          : reauthRequired || permissionDenied
            ? "needs_attention"
            : "failed",
    });
    ingestOutcomes.set(integration.id, {
      syncError,
      reauthRequired,
      permissionDenied,
      durationMs: Date.now() - integrationStartedAt,
      paused: false,
      startedAt: attemptStartedAt,
      ingestError,
      ingestResult,
    });
  }

  // Phase 2: correlation, normalization and the commitment/cycle/
  // evaluation/notification pipeline tail, serialized per organization
  // (E-3) — a concurrent webhook delivery or onboarding backfill for this
  // same organization waits on the same advisory lock rather than racing
  // on Case/NormalizedEvent/Commitment. Runs even for an integration whose
  // ingest just failed: normalization is DB-local and still has whatever
  // RawEvents an earlier successful cycle already stored.
  const ingestMs = Date.now() - orgStartedAt;
  let slaPolicyImport: { provider: IntegrationProvider; result: PolicyImportResult } | null = null;
  const notification: { claims: NotificationClaims | null } = { claims: null };

  // Phase 2 publishes results other readers see; confirm against the database
  // row, not just the local clock, that this worker is still the owner.
  await lease?.assertHeld();

  await withOrganizationSlaLock(prisma, organization.id, async () => {
    await withPerfScope(
      "worker_normalize",
      async () => {
        for (const integration of orderedIntegrations) {
          lease?.assertValid();
          const ingestOutcome = ingestOutcomes.get(integration.id)!;
          let normalizeError: string | null = null;
          let normalizeErrorObject: unknown | null = null;
          let normalization: ProjectionResult | null = null;
          let correlation: IntegrationSyncResult["correlation"] = null;
          let calendarImport: IntegrationSyncResult["calendarImport"] = null;
          let policyImport: IntegrationSyncResult["policyImport"] = null;

          try {
            const adapter = PROVIDERS[integration.provider];
            const synced = await syncIntegration(adapter, {
              prisma,
              integration: integrationRef(integration),
              logger: orgLogger.child({ integrationId: integration.id, provider: integration.provider }),
              // The poll only re-derives what changed since the adapter's own
              // watermark; the reconciliation sweep re-derives everything (and
              // is the backstop for anything the watermark could miss). An
              // operator's re-normalization request (N4.5) forces the full pass
              // on this run whichever kind it is.
              mode: kind === "active_set_poll" && !integration.renormalizeRequestedAt ? "incremental" : "full",
              // Only a work tracker links onto cases through a URL a ticket
              // source recognizes; no need to read the sources for anyone else.
              resolveCaseRef:
                adapter.role === "work_tracker" ? await caseRefResolverFor(prisma, organization.id) : null,
              ensureDefaultCalendarVersion: (organizationId) => ensureDefaultCalendarVersion(prisma, organizationId),
            });
            normalization = synced.normalization;
            correlation = synced.correlation;
            calendarImport = synced.calendarImport;
            policyImport = synced.policyImport;
            if (synced.policyImport) {
              slaPolicyImport = { provider: integration.provider, result: synced.policyImport };
            }
          } catch (error) {
            if (error instanceof LeaseLostError) throw error;
            normalizeErrorObject = error;
            normalizeError =
              error instanceof Error ? error.message : String(error);
            result.failures.push({
              organizationId: organization.id,
              stage: `normalize:${integration.provider}`,
              error: normalizeError,
            });
            captureException(error, {
              organizationId: organization.id,
              integrationId: integration.id,
              provider: integration.provider,
              kind,
              stage: "normalize",
            });
          }

          // The requested full pass is done: clear the request, compare-and-set
          // on the value this run started with so a request made while it ran
          // is kept for the next one. A failed pass leaves it set to retry.
          if (integration.renormalizeRequestedAt && normalizeError === null) {
            await prisma.integration.updateMany({
              where: { id: integration.id, renormalizeRequestedAt: integration.renormalizeRequestedAt },
              data: { renormalizeRequestedAt: null },
            });
          }

          // Nothing was fetched for a paused integration, so there is no sync
          // attempt to record: leave sync health exactly as it was.
          if (ingestOutcome.paused) continue;

          // Every attempted cycle (success or failure, in either phase)
          // updates sync health, so the settings page reflects real state
          // instead of only stdout logs. Ingest's error takes priority when
          // both phases failed — it's the more actionable diagnostic.
          const syncError = ingestOutcome.syncError ?? normalizeError;
          // One history row per attempt, for every provider (N9.9). A `partial` run
          // (budget or per-run cap exhausted, nothing failed) and an ingest stopped on
          // purpose leave `lastSuccessfulSyncAt`, the failure counters and
          // `lastSyncError` exactly as they were: they are neither a success nor a
          // failure, and D13(b) freshness is untouched.
          const classified = classifyRun({
            ingestError: ingestOutcome.ingestError,
            ingestResult: ingestOutcome.ingestResult,
            normalizeError: normalizeErrorObject,
            normalization,
          });
          const runFacts = {
            ingestError: ingestOutcome.ingestError,
            ingestResult: ingestOutcome.ingestResult,
            normalizeError: normalizeErrorObject,
            normalization,
            correlation,
            calendarImport,
            policyImport,
          };
          // D32: one clock reading is both the run's `finishedAt` and the
          // `lastSuccessfulSyncAt` below, so a later clean check is exactly
          // comparable with a stored run. `lastDataChangedAt` moves only when this
          // attempt changed data; a successful no-change attempt is not stored.
          const finishedAt = new Date();
          await recordSyncRun(prisma, {
            organizationId: organization.id,
            integrationId: integration.id,
            startedAt: ingestOutcome.startedAt,
            facts: runFacts,
            classified,
            finishedAt,
            logger: orgLogger,
          });
          const changedData = dataChanged(runFacts) ? { lastDataChangedAt: finishedAt } : {};
          await prisma.integration.update({
            where: { id: integration.id },
            data:
              classified.leavesHealthAlone && syncError === null
                ? { lastSyncAt: new Date(), lastSyncDurationMs: ingestOutcome.durationMs, ...changedData }
                : {
                    lastSyncAt: new Date(),
                    lastSyncError: syncError,
                    lastSyncDurationMs: ingestOutcome.durationMs,
                    ...changedData,
                    ...(syncError === null
                      ? {
                          lastSuccessfulSyncAt: finishedAt,
                          consecutiveFailures: 0,
                          failingSince: null,
                        }
                      : {
                          consecutiveFailures: { increment: 1 },
                          // Do not overwrite the beginning of an outage on every
                          // retry; this is the customer-facing failure duration.
                          failingSince: integration.failingSince === null ? new Date() : undefined,
                        }),
                    ...(ingestOutcome.reauthRequired ? { status: "reauth_required" as const } : {}),
                  },
          });

          // `permission_denied` transitions (roadmap step 32) are compare-and-set
          // on the current status, so a disconnect or reconnect that landed
          // mid-cycle is never overwritten: only `connected` becomes
          // `permission_denied`, and only `permission_denied` clears back to
          // `connected`. Unlike reauth (cleared only by the OAuth callback), that
          // happens on the first clean sync — restoring the user's access
          // provider-side needs no action in this app.
          const permissionTransition = ingestOutcome.permissionDenied
            ? { from: "connected" as const, to: "permission_denied" as const }
            : syncError === null && integration.status === "permission_denied"
              ? {
                  from: "permission_denied" as const,
                  to: "connected" as const,
                }
              : null;
          if (permissionTransition) {
            await prisma.integration.updateMany({
              where: {
                id: integration.id,
                status: permissionTransition.from,
              },
              data: { status: permissionTransition.to },
            });
          }
        }
      },
      { organizationId: organization.id, kind },
    );

    // Evaluation runs even when ingestion failed: time keeps passing, so a
    // commitment can cross a warn threshold or breach on already-stored events.
    // One `asOf` snapshot for this organization's whole create -> derive
    // Next Reply cycles -> evaluate pass, so the three pipelines agree on
    // "now" instead of each independently calling `new Date()`.
    const asOfDate = new Date();
    const asOf = asOfDate.toISOString();

    // Policy versions, calendars and customer overrides, read once and
    // shared by the commitment, re-resolution and next-reply pipelines
    // instead of each re-reading the same rows. Loaded after normalization
    // (which runs the Zendesk policy/calendar import) so it sees the
    // tick's final policy state; a failure here fails the same stages
    // that would each have failed reading it themselves.
    let policyContext: Awaited<ReturnType<typeof loadPolicyContext>> | undefined;
    try {
      policyContext = await loadPolicyContext(prisma, organization.id);
    } catch (error) {
      // Each pipeline falls back to its own read and reports its own failure.
      orgLogger.warn("policy_context_load_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    lease?.assertValid();
    await withPerfScope(
      "worker_commitment",
      async () => {
        try {
          const commitments = await runCommitmentPipeline(
            prisma,
            organization.id,
            { context: policyContext },
          );
          result.commitmentsCreated += commitments.commitmentsCreated;

          if (slaPolicyImport) {
            await recordSlaImportSummary(prisma, organization.id, {
              provider: slaPolicyImport.provider,
              unsupportedConditions:
                slaPolicyImport.result.unsupportedConditions,
              unsupportedMetrics: slaPolicyImport.result.unsupportedMetrics,
              policiesWithNoUsableTargets:
                slaPolicyImport.result.policiesWithNoUsableTargets,
              policiesWithUnresolvedSchedule:
                slaPolicyImport.result.policiesWithUnresolvedSchedule,
              policiesArchived: slaPolicyImport.result.policiesArchived,
              casesWithNoMatchingPolicy:
                commitments.casesWithNoMatchingPolicy,
            });
          }
        } catch (error) {
          result.failures.push({
            organizationId: organization.id,
            stage: "commitments",
            error: error instanceof Error ? error.message : String(error),
          });
          captureException(error, {
            organizationId: organization.id,
            kind,
            stage: "commitments",
          });
        }
      },
      { organizationId: organization.id, kind },
    );

    // Before Next Reply cycle derivation: a future cycle reads its anchor
    // commitment's *current* policy version fresh from the DB, so a
    // policy-driving Case attribute change (priority, customer, tier) must
    // already be re-resolved by the time that pipeline runs.
    lease?.assertValid();
    await withPerfScope(
      "worker_re_resolution",
      async () => {
        try {
          const reResolution = await runCommitmentReResolutionPipeline(
            prisma,
            organization.id,
            {
              asOf,
              logger: orgLogger,
              context: policyContext,
            },
          );
          result.commitmentsReResolved += reResolution.commitmentsUpdated;
        } catch (error) {
          result.failures.push({
            organizationId: organization.id,
            stage: "commitment_re_resolution",
            error: error instanceof Error ? error.message : String(error),
          });
          captureException(error, {
            organizationId: organization.id,
            kind,
            stage: "commitment_re_resolution",
          });
        }
      },
      { organizationId: organization.id, kind },
    );

    lease?.assertValid();
    await withPerfScope(
      "worker_next_reply",
      async () => {
        try {
          const cycles = await runNextReplyCyclePipeline(
            prisma,
            organization.id,
            {
              asOf,
              context: policyContext,
              // The poll only re-derives cycles for cases that can have
              // changed; the reconciliation sweep re-derives every case.
              ...(kind === "active_set_poll"
                ? {
                    scope: "active" as const,
                    changedSince: new Date(
                      asOfDate.getTime() -
                        Math.max(
                          ACTIVE_LOOKBACK_FLOOR_MS,
                          ACTIVE_LOOKBACK_INTERVALS *
                            (ctx.activePollMs ?? DEFAULT_ACTIVE_POLL_MS),
                        ),
                    ),
                  }
                : {}),
            },
          );
          result.cyclesCreated += cycles.cyclesCreated;
          result.cyclesCancelled += cycles.cyclesCancelled;
          result.cyclesRestored += cycles.cyclesRestored;
        } catch (error) {
          result.failures.push({
            organizationId: organization.id,
            stage: "next_reply_cycles",
            error: error instanceof Error ? error.message : String(error),
          });
          captureException(error, {
            organizationId: organization.id,
            kind,
            stage: "next_reply_cycles",
          });
        }
      },
      { organizationId: organization.id, kind },
    );

    let notificationCandidates: EvaluationPipelineResult["notificationCandidates"] =
      [];
    lease?.assertValid();
    await withPerfScope(
      "worker_evaluate",
      async () => {
        try {
          const evaluations = await runEvaluationPipeline(
            prisma,
            organization.id,
            {
              asOf,
              scope: SCOPE_BY_KIND[kind],
              freshness: {
                expectedIntervalMs: ctx.activePollMs ?? DEFAULT_ACTIVE_POLL_MS,
                graceFactor: 3,
              },
            },
          );
          result.commitmentsConsidered += evaluations.commitmentsConsidered;
          result.evaluationsCreated += evaluations.evaluationsCreated;
          result.commitmentsFinalized += evaluations.commitmentsFinalized;
          notificationCandidates = evaluations.notificationCandidates;
        } catch (error) {
          result.failures.push({
            organizationId: organization.id,
            stage: "evaluation",
            error: error instanceof Error ? error.message : String(error),
          });
          captureException(error, {
            organizationId: organization.id,
            kind,
            stage: "evaluation",
          });
        }
      },
      { organizationId: organization.id, kind },
    );

    // Claim stage: DB-only, so it stays inside the lock. It decides which
    // candidates still need an alert and inserts their `Notification`
    // claim rows (the `(commitmentId, threshold)` unique constraint makes
    // that idempotent against a concurrent cycle or webhook). The slow
    // Slack/SMTP sends happen below, after the lock is released, so they
    // never make a webhook delivery for this organization wait on them.
    // Runs even for organizations with no Slack workspace connected and no
    // SMTP configured — it no-ops cheaply in that case.
    lease?.assertValid();
    await withPerfScope(
      "worker_notify_claim",
      async () => {
        try {
          notification.claims = await claimNotifications(
            prisma,
            organization.id,
            notificationCandidates,
            { appUrl: config.appUrl },
          );
        } catch (error) {
          result.failures.push({
            organizationId: organization.id,
            stage: "notifications",
            error: error instanceof Error ? error.message : String(error),
          });
          captureException(error, {
            organizationId: organization.id,
            kind,
            stage: "notifications",
          });
        }
      },
      { organizationId: organization.id, kind },
    );
  });

  // Delivery stage, outside the lock. A commitment that fails to notify
  // never blocks another organization's cycle.
  if (notification.claims) {
    const claims = notification.claims;
    // Sending is the one step that cannot be undone (a Slack message, an
    // email): confirm against the database that this worker still owns the
    // organization before it, not just against the local lease clock.
    await lease?.assertHeld();
    await withPerfScope(
      "worker_notify",
      async () => {
        try {
          const notifications = await deliverClaimedNotifications(
            prisma,
            claims,
          );
          result.notificationsSent += notifications.notificationsSent;
          for (const failed of notifications.notificationsFailed) {
            result.failures.push({
              organizationId: organization.id,
              stage: "notifications",
              error: `commitment ${failed.commitmentId} threshold ${failed.threshold}: ${failed.error}`,
            });
          }
        } catch (error) {
          result.failures.push({
            organizationId: organization.id,
            stage: "notifications",
            error: error instanceof Error ? error.message : String(error),
          });
          captureException(error, {
            organizationId: organization.id,
            kind,
            stage: "notifications",
          });
        }
      },
      { organizationId: organization.id, kind },
    );
  }

  // Retention (N9.9): sync-run history 30 days, expired custom drafts 14 days.
  // Reconciliation only, per organization; a prune that fails never fails the run.
  if (kind === "reconciliation_sweep") {
    await pruneSyncHistory(prisma, organization.id, new Date()).catch((error: unknown) => {
      orgLogger.warn("sync_history_prune_failed", { error: error instanceof Error ? error.name : "error" });
    });
  }

  // Monthly customer report (N5.6). Reconciliation runs only: it is the
  // slower, once-per-interval tick, and a month is checked, not recomputed,
  // each time (one organization read, one deliveries read once settled).
  if (kind === "reconciliation_sweep") {
    await withPerfScope(
      "worker_monthly_report",
      async () => {
        try {
          const report = await deliverMonthlyReport(prisma, organization.id, {
            appUrl: config.appUrl ?? null,
            issueLinkProviders: ISSUE_LINK_PROVIDERS,
            enabled: (await ctx.monthlyReportEnabled?.()) ?? true,
            // Sending is the one step that cannot be undone: confirm against the database that this worker still owns the organization.
            beforeSend: async () => {
              await lease?.assertHeld();
            },
          });
          if (Object.values(report.channels).some((outcome) => outcome === "sent" || outcome === "failed")) {
            orgLogger.info("monthly_report_delivered", { position, period: report.period, channels: report.channels });
          }
        } catch (error) {
          // Not a stage failure of the SLA pipeline: a report that cannot be built or sent must
          // not mark the worker degraded. The reason is on `ReportDelivery.error` for the operator;
          // only losing the lease (not ours to record) is passed up.
          if (error instanceof LeaseLostError) throw error;
          orgLogger.warn("monthly_report_failed", { position, error: error instanceof Error ? error.message : String(error) });
          captureException(error, { organizationId: organization.id, kind, stage: "monthly_report" });
        }
      },
      { organizationId: organization.id, kind },
    );
  }

  // Trial lifecycle (N6.4, D27). Reconciliation runs only, once per organization
  // and trial end date (the event claim in `markTrialExpiry` is the idempotency
  // key). It emails the owner and records the event for the admin; it changes
  // nothing about monitoring, evaluation or alerting for this organization.
  if (kind === "reconciliation_sweep" && ((await ctx.entitlementsEnforced?.()) ?? false)) {
    await withPerfScope(
      "worker_trial_expiry",
      async () => {
        try {
          const outcome = await deliverTrialExpiryNotice(prisma, organization.id, {
            appUrl: config.appUrl ?? null,
            beforeSend: async () => {
              await lease?.assertHeld();
            },
          });
          if (outcome === "sent" || outcome === "no_owner") orgLogger.info("trial_expiry_handled", { position, outcome });
        } catch (error) {
          // Not a stage failure of the SLA pipeline: a notice that cannot be sent must not mark the worker degraded.
          if (error instanceof LeaseLostError) throw error;
          orgLogger.warn("trial_expiry_notice_failed", { position, error: error instanceof Error ? error.message : String(error) });
          captureException(error, { organizationId: organization.id, kind, stage: "trial_expiry" });
        }
      },
      { organizationId: organization.id, kind },
    );
  }

  orgLogger.info("organization_finished", {
    position,
    durationMs: Date.now() - orgStartedAt,
    ingestMs,
    pipelineMs: Date.now() - orgStartedAt - ingestMs,
    integrations: organization.integrations.length,
  });

}

/**
 * One polling cycle across every organization: pull what changed from each
 * connected provider, project it into cases/commitments, then evaluate and
 * persist Evaluation rows (Phase 16). Failures are recorded per organization
 * and per stage rather than thrown — one broken integration must never stop
 * the other organizations in the same cycle from being evaluated.
 */
export async function runCycle(
  prisma: PrismaClient,
  config: WorkerConfig,
  kind: CycleKind,
  // Minted once per tick by `index.ts` (roadmap 7.4) — the one value that
  // ties every structured log line from this run together, including ones
  // emitted deep in a pipeline (`.child()`'d loggers below), regardless of
  // which organization or stage they came from.
  cycleId: string = `${kind}:${Date.now()}`,
  // The configured active-poll interval (`WorkerSettings`, read fresh by
  // `index.ts` each tick) — sizes the poll's "new events" lookback.
  options: {
    activePollMs?: number;
    /** Restrict the cycle to these organizations — used by the perf-baseline script so a measurement run never touches unrelated organizations' live integrations. Omit for every organization. */
    organizationIds?: string[];
    /** Overrides `config.organizationConcurrency` — how many organizations are processed at once. */
    organizationConcurrency?: number;
  } = {},
): Promise<CycleResult> {
  const cycleLogger = createLogger({ cycleId, kind });
  const result = emptyCycleResult(kind);

  const organizations = await prisma.organization.findMany({
    ...(options.organizationIds
      ? { where: { id: { in: options.organizationIds } } }
      : {}),
    select: ORGANIZATION_TO_PROCESS_SELECT,
  });

  // Organizations run concurrently (bounded — see `forEachWithConcurrency`);
  // integrations within one organization stay sequential. Everything below
  // that is per-organization (`ingestOutcomes`, `slaPolicyImport`,
  // `notification`, the loggers) is declared inside this function, so
  // concurrent organizations share nothing but `result`, and every update to
  // that is a synchronous `+=` / `push` with no `await` between its read and
  // write — it can't interleave with another organization's update.
  const organizationConcurrency = normalizeConcurrency(
    options.organizationConcurrency ?? config.organizationConcurrency,
  );
  let organizationsInFlight = 0;

  const processOne = async (
    organization: OrganizationToProcess,
    index: number,
  ): Promise<void> => {
    organizationsInFlight += 1;
    try {
      await processOrganization(prisma, config, organization, {
        kind,
        logger: cycleLogger,
        result,
        activePollMs: options.activePollMs,
        position: `${index + 1}/${organizations.length}`,
        inFlight: () => organizationsInFlight,
      });
    } finally {
      organizationsInFlight -= 1;
    }
  };

  await forEachWithConcurrency(organizations, organizationConcurrency, processOne);

  return result;
}
