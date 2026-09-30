import { recordSlaImportSummary, withOrganizationSlaLock, type PrismaClient } from "@sla/db";
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
import {
  runZendeskBusinessCalendarImport,
  runZendeskJiraLinkCorrelation,
  runZendeskNormalization,
  runZendeskSlaPolicyImport,
  type BusinessCalendarImportResult,
  type JiraLinkCorrelationResult,
  type NormalizationResult,
  type SlaPolicyImportResult,
  type ZendeskCursor,
} from "@sla/zendesk";
import {
  runJiraCorrelation,
  runJiraNormalization,
  type CorrelationResult,
  type JiraCursor,
  type JiraNormalizationResult,
} from "@sla/jira";
import { caseRefResolverFor } from "@/lib/case-ref";

/**
 * The sources the onboarding backfill routes pull from. Their event sets
 * together are what a Zendesk case's commitments get evaluated against, so
 * neither route may finalize a commitment while the other's first backfill
 * is still outstanding.
 */
type SourceProvider = "zendesk" | "jira";

export interface SourceSyncProjectionResult {
  zendesk: {
    normalization: NormalizationResult;
    jiraLinkCorrelation: JiraLinkCorrelationResult;
    businessCalendarImport: BusinessCalendarImportResult;
    slaPolicyImport: SlaPolicyImportResult;
  } | null;
  jira: { correlation: CorrelationResult; normalization: JiraNormalizationResult } | null;
  commitments: CommitmentPipelineResult;
  reResolution: CommitmentReResolutionResult;
  /**
   * Unlike `evaluation`, never deferred by `pendingProviders`: Next Reply
   * cycles are derived only from the case's own ticket-source events
   * (zendesk/intercom), never Jira's, so an outstanding Jira backfill has no
   * bearing on them — same treatment as `commitments`.
   */
  nextReplyCycles: NextReplyCyclePipelineResult;
  /** Null while `pendingProviders` is non-empty — evaluation is deferred, not skipped. */
  evaluation: EvaluationPipelineResult | null;
  pendingProviders: SourceProvider[];
}

/**
 * The DB-only tail of a Zendesk or Jira backfill: project stored RawEvents
 * into cases and events, create commitments, and — once every connected
 * source has completed its first backfill — evaluate them with the same
 * `runEvaluationPipeline` the worker and webhook path use, so a fresh connect
 * doesn't leave commitments at their `on_track`/unfinalized defaults until
 * the worker's next poll.
 *
 * Mirrors the worker cycle's order (Zendesk, then Jira, then commitments,
 * then commitment re-resolution, then Next Reply cycles, then evaluation).
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
    const integrations = await prisma.integration.findMany({
      where: { organizationId, provider: { in: ["zendesk", "jira"] }, status: { not: "disconnected" } },
      select: { id: true, provider: true, cursor: true },
    });
    const zendesk = integrations.find((i) => i.provider === "zendesk");
    const jira = integrations.find((i) => i.provider === "jira");
    const zendeskReady = (zendesk?.cursor as ZendeskCursor | null)?.backfillCompletedAt != null;
    const jiraReady = (jira?.cursor as JiraCursor | null)?.backfillCompletedAt != null;

    const pendingProviders: SourceProvider[] = [];
    if (!zendeskReady) pendingProviders.push("zendesk");
    if (jira && !jiraReady) pendingProviders.push("jira");

    const zendeskResult =
      zendesk && zendeskReady
        ? {
            normalization: await runZendeskNormalization(prisma, zendesk.id),
            // Independent of Jira's own correlation below: the official
            // Zendesk↔Jira link signal still establishes the relationship
            // even when a Jira remote link is stale or Jira isn't connected
            // at all. Must run after normalization, which is what creates
            // the Cases this looks up by ticket id.
            jiraLinkCorrelation: await runZendeskJiraLinkCorrelation(prisma, zendesk.id),
            businessCalendarImport: await runZendeskBusinessCalendarImport(prisma, zendesk.id),
            slaPolicyImport: await runZendeskSlaPolicyImport(prisma, zendesk.id, (organizationId) =>
              ensureDefaultCalendarVersion(prisma, organizationId),
            ),
          }
        : null;
    const jiraResult =
      jira && jiraReady
        ? {
            correlation: await runJiraCorrelation(prisma, jira.id, await caseRefResolverFor(prisma, organizationId)),
            normalization: await runJiraNormalization(prisma, jira.id),
          }
        : null;

    const asOf = new Date().toISOString();

    const commitments = await runCommitmentPipeline(prisma, organizationId);
    const reResolution = await runCommitmentReResolutionPipeline(prisma, organizationId, { asOf });

    if (zendeskResult) {
      const { unsupportedConditions, unsupportedMetrics, policiesWithNoUsableTargets, policiesWithUnresolvedSchedule, policiesArchived } =
        zendeskResult.slaPolicyImport;
      await recordSlaImportSummary(prisma, organizationId, {
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

    return {
      zendesk: zendeskResult,
      jira: jiraResult,
      commitments,
      reResolution,
      nextReplyCycles,
      evaluation,
      pendingProviders,
    };
  });
}
