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
  recordSlaImportSummary,
  withOrganizationSlaLock,
  withPerfScope,
  type PrismaClient,
} from "@sla/db";
import {
  GithubPermissionDeniedError,
  GithubReauthRequiredError,
  runGithubBackfill,
  runGithubCorrelation,
  runGithubNormalization,
} from "@sla/github";
import {
  IntercomPermissionDeniedError,
  IntercomReauthRequiredError,
  runIntercomBackfill,
  runIntercomNormalization,
} from "@sla/intercom";
import {
  JiraPermissionDeniedError,
  JiraReauthRequiredError,
  runJiraBackfill,
  runJiraCorrelation,
  runJiraNormalization,
} from "@sla/jira";
import {
  LinearPermissionDeniedError,
  LinearReauthRequiredError,
  runLinearBackfill,
  runLinearCorrelation,
  runLinearNormalization,
} from "@sla/linear";
import { createLogger, type Logger } from "@sla/logger";
import {
  claimNotifications,
  deliverClaimedNotifications,
  type NotificationClaims,
} from "@sla/notifications";
import {
  runZendeskBackfill,
  runZendeskBusinessCalendarImport,
  runZendeskJiraLinkCorrelation,
  runZendeskNormalization,
  runZendeskSlaPolicyImport,
  ZendeskPermissionDeniedError,
  ZendeskReauthRequiredError,
  type SlaPolicyImportResult,
} from "@sla/zendesk";
import { caseRefResolverFor } from "./case-ref";
import { forEachWithConcurrency, normalizeConcurrency } from "./concurrency";
import type { WorkerConfig } from "./config";
import { LeaseLostError, type LeaseGuard } from "./lease";
import { captureException } from "./sentry";

function isPermissionDeniedError(error: unknown): boolean {
  return (
    error instanceof ZendeskPermissionDeniedError ||
    error instanceof JiraPermissionDeniedError ||
    error instanceof LinearPermissionDeniedError ||
    error instanceof IntercomPermissionDeniedError ||
    error instanceof GithubPermissionDeniedError
  );
}

/**
 * The organization has no OAuth app configuration for this provider, so there
 * is nothing the worker can ingest for it. That is an expected configuration
 * state, not a worker failure: the integration is skipped, the organization
 * carries on with its other integrations, and nothing is counted against the
 * run. Deliberately narrow — an *unreadable* config
 * (`IntegrationConfigUnreadableError`), a missing `NEXTAUTH_URL` (a
 * deployment problem) and every provider error stay real failures.
 */
export class IntegrationNotConfiguredError extends Error {
  constructor(providerLabel: string) {
    super(`${providerLabel} is not configured for this organization`);
    this.name = "IntegrationNotConfiguredError";
  }
}

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
 * GitHub's correlator depends on that organization's Jira/Linear CaseLinks
 * already existing (it links transitively through them — see
 * packages/github/src/correlate.ts), so within one organization's
 * integrations, github is processed after jira/linear where possible. A
 * miss just self-heals on the next poll either way (upsert-based), but
 * same-cycle ordering avoids an unnecessary extra cycle's delay.
 */
const PROVIDER_CYCLE_PRIORITY: Partial<Record<string, number>> = { github: 1 };

/** What `processOrganization` needs to know about the organization it is given. */
export interface OrganizationToProcess {
  id: string;
  integrations: { id: string; provider: string; credentials: unknown; status: string }[];
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
    select: { id: true, provider: true, credentials: true, status: true },
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
    (a, b) =>
      (PROVIDER_CYCLE_PRIORITY[a.provider] ?? 0) -
      (PROVIDER_CYCLE_PRIORITY[b.provider] ?? 0),
  );

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
    }
  >();

  for (const integration of orderedIntegrations) {
    // Outside the try below on purpose: losing the lease must abort the run,
    // not be recorded as this integration's sync error. Each provider call
    // advances the integration's cursor, so this is the gate that keeps a
    // worker that lost the organization from ingesting it.
    lease?.assertValid();
    const integrationStartedAt = Date.now();
    let syncError: string | null = null;
    let reauthRequired = false;
    let permissionDenied = false;
    let skipped = false;
    const providerLabel = `${integration.provider[0]!.toUpperCase()}${integration.provider.slice(1)}`;

    try {
      if (integration.provider === "zendesk") {
        if (!config.appUrl)
          throw new Error("Worker app URL is not configured (NEXTAUTH_URL)");
        const zendeskConfig = await getIntegrationConfig(
          prisma,
          organization.id,
          "zendesk",
        );
        if (!zendeskConfig)
          throw new IntegrationNotConfiguredError("Zendesk");
        await runZendeskBackfill(
          prisma,
          integration.id,
          {
            ...zendeskConfig,
            redirectUri: `${config.appUrl}/api/integrations/zendesk/callback`,
          },
          {
            logger: orgLogger.child({
              integrationId: integration.id,
              provider: "zendesk",
            }),
          },
        );
      } else if (integration.provider === "jira") {
        if (!config.appUrl)
          throw new Error("Worker app URL is not configured (NEXTAUTH_URL)");
        const jiraConfig = await getIntegrationConfig(
          prisma,
          organization.id,
          "jira",
        );
        if (!jiraConfig)
          throw new IntegrationNotConfiguredError("Jira");
        await runJiraBackfill(prisma, integration.id, {
          ...jiraConfig,
          redirectUri: `${config.appUrl}/api/integrations/jira/callback`,
        });
      } else if (integration.provider === "linear") {
        // Linear's backfill needs no OAuth client config to run (roadmap
        // step 14: its tokens carry no refresh dance), unlike Jira/Zendesk.
        await runLinearBackfill(prisma, integration.id);
      } else if (integration.provider === "intercom") {
        // Intercom's backfill needs no OAuth client config to run either
        // (roadmap step 22: like Linear, its tokens carry no refresh
        // dance) — only the connect/callback routes need the app's
        // client id/secret.
        await runIntercomBackfill(prisma, integration.id);
      } else {
        // Unlike Linear/Intercom, GitHub needs its App's client id/secret
        // here: GitHub App user tokens expire and are refreshed like
        // Jira's (roadmap step 38).
        const githubConfig = await getIntegrationConfig(
          prisma,
          organization.id,
          "github",
        );
        if (!githubConfig)
          throw new IntegrationNotConfiguredError("GitHub");
        await runGithubBackfill(prisma, integration.id, githubConfig);
      }
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
      reauthRequired =
        error instanceof ZendeskReauthRequiredError ||
        error instanceof JiraReauthRequiredError ||
        error instanceof LinearReauthRequiredError ||
        error instanceof IntercomReauthRequiredError ||
        error instanceof GithubReauthRequiredError;
      // A 403 (roadmap step 32): the token works but the connecting user
      // lost access provider-side — surfaced as its own status, since the
      // fix is restoring that user's permissions, not reconnecting.
      permissionDenied = !reauthRequired && isPermissionDeniedError(error);
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
  let slaPolicyImportResult: SlaPolicyImportResult | null = null;
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

          try {
            if (integration.provider === "zendesk") {
              // The poll only re-derives tickets touched since the
              // watermark; the reconciliation sweep re-derives them all (and is
              // the backstop for anything the watermark could miss).
              await runZendeskNormalization(prisma, integration.id, {
                mode:
                  kind === "active_set_poll" ? "incremental" : "full",
              });
              // Independent of Jira's own correlation below: the official
              // Zendesk↔Jira link signal still establishes the relationship
              // even when a Jira remote link is stale or Jira isn't connected
              // at all. Must run after normalization, which is what creates
              // the Cases this looks up by ticket id.
              await runZendeskJiraLinkCorrelation(prisma, integration.id);
              await runZendeskBusinessCalendarImport(prisma, integration.id);
              slaPolicyImportResult = await runZendeskSlaPolicyImport(
                prisma,
                integration.id,
                (organizationId) => ensureDefaultCalendarVersion(prisma, organizationId),
              );
            } else if (integration.provider === "jira") {
              await runJiraCorrelation(prisma, integration.id, await caseRefResolverFor(prisma, organization.id));
              await runJiraNormalization(prisma, integration.id);
            } else if (integration.provider === "linear") {
              await runLinearCorrelation(prisma, integration.id, await caseRefResolverFor(prisma, organization.id));
              await runLinearNormalization(prisma, integration.id);
            } else if (integration.provider === "intercom") {
              // No correlation step: Intercom is a ticket source that creates
              // its own Cases, not an engineering-leg source that links onto
              // one.
              await runIntercomNormalization(prisma, integration.id);
            } else {
              // Correlation links transitively through this org's existing
              // Jira/Linear CaseLinks (roadmap step 23) rather than any direct
              // Zendesk knowledge.
              await runGithubCorrelation(prisma, integration.id);
              await runGithubNormalization(prisma, integration.id);
            }
          } catch (error) {
            if (error instanceof LeaseLostError) throw error;
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

          // Every attempted cycle (success or failure, in either phase)
          // updates sync health, so the settings page reflects real state
          // instead of only stdout logs. Ingest's error takes priority when
          // both phases failed — it's the more actionable diagnostic.
          const syncError = ingestOutcome.syncError ?? normalizeError;
          await prisma.integration.update({
            where: { id: integration.id },
            data: {
              lastSyncAt: new Date(),
              lastSyncError: syncError,
              ...(ingestOutcome.reauthRequired
                ? { status: "reauth_required" as const }
                : {}),
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

          if (slaPolicyImportResult) {
            await recordSlaImportSummary(prisma, organization.id, {
              unsupportedConditions:
                slaPolicyImportResult.unsupportedConditions,
              unsupportedMetrics: slaPolicyImportResult.unsupportedMetrics,
              policiesWithNoUsableTargets:
                slaPolicyImportResult.policiesWithNoUsableTargets,
              policiesWithUnresolvedSchedule:
                slaPolicyImportResult.policiesWithUnresolvedSchedule,
              policiesArchived: slaPolicyImportResult.policiesArchived,
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
  // that is per-organization (`ingestOutcomes`, `slaPolicyImportResult`,
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
