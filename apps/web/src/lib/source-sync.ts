import { recordSlaImportSummary, withOrganizationSlaLock, type IntegrationProvider, type PrismaClient } from "@sla/db";
import {
  ensureDefaultCalendarVersion,
  runCommitmentPipeline,
  runCommitmentReResolutionPipeline,
  runEvaluationPipeline,
  runNextReplyCyclePipeline,
  type CommitmentPipelineResult,
  type CommitmentReResolutionResult,
  type EvaluationPipelineResult,
  type NextReplyCyclePipelineResult,
} from "@sla/commitments";
import { syncIntegration, type IntegrationSyncResult } from "@sla/ingestion";
import { caseRefResolverFor } from "@/lib/case-ref";
import { PROVIDERS, providerRole } from "@/lib/providers";

/** What one connected source's projection produced: its normalization, its correlation (trackers, and Zendesk's official links), and its imports. */
export type SourceSyncProviderResult = IntegrationSyncResult;

export interface SourceSyncProjectionResult {
  /** Keyed by provider; only the sources whose first backfill had completed. */
  providers: Partial<Record<IntegrationProvider, SourceSyncProviderResult>>;
  commitments: CommitmentPipelineResult;
  reResolution: CommitmentReResolutionResult;
  /**
   * Unlike `evaluation`, never deferred by `pendingProviders`: Next Reply
   * cycles are derived only from the case's own ticket-source events, never a
   * tracker's, so an outstanding tracker backfill has no bearing on them —
   * same treatment as `commitments`.
   */
  nextReplyCycles: NextReplyCyclePipelineResult;
  /** Null while `pendingProviders` is non-empty — evaluation is deferred, not skipped. */
  evaluation: EvaluationPipelineResult | null;
  pendingProviders: IntegrationProvider[];
}

/**
 * The sources the onboarding backfill routes pull from: ticket sources and
 * work trackers. Their event sets together are what a case's commitments get
 * evaluated against, so no route may finalize a commitment while another
 * connected source's first backfill is still outstanding. A code host is
 * projected by its own route and never gates evaluation.
 */
const isOnboardingSource = (provider: IntegrationProvider) => providerRole(provider) !== "code_host";

/**
 * The DB-only tail of a ticket-source or tracker backfill: project stored RawEvents
 * into cases and events, create commitments, and — once every connected
 * source has completed its first backfill — evaluate them with the same
 * `runEvaluationPipeline` the worker and webhook path use, so a fresh connect
 * doesn't leave commitments at their `on_track`/unfinalized defaults until
 * the worker's next poll.
 *
 * Mirrors the worker cycle's order (ticket sources, then trackers, then
 * commitments, then commitment re-resolution, then Next Reply cycles, then
 * evaluation).
 * Every source whose backfill has
 * completed is re-projected from its stored RawEvents, not just the
 * caller's: the other route may have fetched without projecting yet, or run
 * Jira correlation before Zendesk's cases existed. All steps are idempotent,
 * so the redundant pass is harmless.
 *
 * Evaluation uses the reconciliation scope ("all"): a commitment finalized
 * before Jira was connected is re-checked against the now-complete event set
 * rather than left on its earlier result. Commitment creation and Next Reply
 * cycle derivation both run unconditionally, not gated by `pendingProviders`
 * like evaluation is — see `nextReplyCycles` above for why that's safe.
 *
 * One `asOf` snapshot covers commitment creation, cycle derivation, and
 * evaluation, so all three agree on "now" for this sync.
 */
export async function projectAndEvaluateSourceSyncs(
  prisma: PrismaClient,
  organizationId: string,
): Promise<SourceSyncProjectionResult> {
  return withOrganizationSlaLock(prisma, organizationId, async () => {
    const connected = await prisma.integration.findMany({
      where: { organizationId, status: { not: "disconnected" } },
      select: { id: true, provider: true, status: true, cursor: true },
    });
    // Ticket sources first: they create the Cases the trackers link onto.
    const roleOrder = ["ticket_source", "work_tracker"] as const;
    const integrations = connected
      .filter((i) => isOnboardingSource(i.provider))
      .sort((a, b) => roleOrder.indexOf(providerRole(a.provider) as "ticket_source") - roleOrder.indexOf(providerRole(b.provider) as "ticket_source"));
    const backfilled = (i: { cursor: unknown }) =>
      (i.cursor as { backfillCompletedAt?: string } | null)?.backfillCompletedAt != null;

    // With no ticket source connected there is nothing to evaluate against
    // yet, so evaluation waits (reported as the first ticket source, the
    // historical name).
    const pendingProviders: IntegrationProvider[] = [];
    if (!integrations.some((i) => providerRole(i.provider) === "ticket_source")) {
      pendingProviders.push(Object.values(PROVIDERS).find((a) => a.role === "ticket_source")!.provider);
    }
    for (const integration of integrations) if (!backfilled(integration)) pendingProviders.push(integration.provider);

    const resolveCaseRef = integrations.some((i) => providerRole(i.provider) === "work_tracker")
      ? await caseRefResolverFor(prisma, organizationId)
      : null;

    const providers: SourceSyncProjectionResult["providers"] = {};
    for (const integration of integrations) {
      if (!backfilled(integration)) continue;
      // Every source whose backfill has completed is re-projected from its
      // stored RawEvents, not just the caller's: the other route may have
      // fetched without projecting yet, or run a tracker's correlation before
      // the ticket source's cases existed. All steps are idempotent.
      providers[integration.provider] = await syncIntegration(PROVIDERS[integration.provider], {
        prisma,
        integration: { id: integration.id, organizationId, provider: integration.provider, status: integration.status },
        mode: "full",
        resolveCaseRef,
        ensureDefaultCalendarVersion: (orgId) => ensureDefaultCalendarVersion(prisma, orgId),
      });
    }

    const asOf = new Date().toISOString();

    const commitments = await runCommitmentPipeline(prisma, organizationId);
    const reResolution = await runCommitmentReResolutionPipeline(prisma, organizationId, { asOf });

    for (const [provider, synced] of Object.entries(providers) as [IntegrationProvider, SourceSyncProviderResult][]) {
      if (!synced.policyImport) continue;
      const { unsupportedConditions, unsupportedMetrics, policiesWithNoUsableTargets, policiesWithUnresolvedSchedule, policiesArchived } =
        synced.policyImport;
      await recordSlaImportSummary(prisma, organizationId, {
        provider,
        unsupportedConditions,
        unsupportedMetrics,
        policiesWithNoUsableTargets,
        policiesWithUnresolvedSchedule,
        policiesArchived,
        casesWithNoMatchingPolicy: commitments.casesWithNoMatchingPolicy,
      });
    }
    const nextReplyCycles = await runNextReplyCyclePipeline(prisma, organizationId, { asOf });
    const evaluation =
      pendingProviders.length === 0
        ? await runEvaluationPipeline(prisma, organizationId, { asOf, scope: "all" })
        : null;

    return { providers, commitments, reResolution, nextReplyCycles, evaluation, pendingProviders };
  });
}
