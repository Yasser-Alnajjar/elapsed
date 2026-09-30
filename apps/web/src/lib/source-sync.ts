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
} from "@sla/zendesk";
import { runIntercomNormalization, type NormalizationResult as IntercomNormalizationResult } from "@sla/intercom";
import {
  runLinearCorrelation,
  runLinearNormalization,
  type CorrelationResult as LinearCorrelationResult,
  type LinearNormalizationResult,
} from "@sla/linear";
import {
  runJiraCorrelation,
  runJiraNormalization,
  type CorrelationResult,
  type JiraNormalizationResult,
} from "@sla/jira";
import { caseRefResolverFor } from "@/lib/case-ref";

/**
 * The sources the onboarding backfill routes pull from: a ticket source
 * (Zendesk or Intercom) and a tracker (Jira or Linear). Their event sets
 * together are what a case's commitments get evaluated against, so no route
 * may finalize a commitment while another connected source's first backfill
 * is still outstanding.
 */
type SourceProvider = "zendesk" | "intercom" | "jira" | "linear";

export interface SourceSyncProjectionResult {
  zendesk: {
    normalization: NormalizationResult;
    jiraLinkCorrelation: JiraLinkCorrelationResult;
    businessCalendarImport: BusinessCalendarImportResult;
    slaPolicyImport: SlaPolicyImportResult;
  } | null;
  intercom: { normalization: IntercomNormalizationResult } | null;
  jira: { correlation: CorrelationResult; normalization: JiraNormalizationResult } | null;
  linear: { correlation: LinearCorrelationResult; normalization: LinearNormalizationResult } | null;
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
  pendingProviders: SourceProvider[];
}

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
    const integrations = await prisma.integration.findMany({
      where: {
        organizationId,
        provider: { in: ["zendesk", "intercom", "jira", "linear"] },
        status: { not: "disconnected" },
      },
      select: { id: true, provider: true, cursor: true },
    });
    const byProvider = (provider: SourceProvider) => integrations.find((i) => i.provider === provider);
    const zendesk = byProvider("zendesk");
    const intercom = byProvider("intercom");
    const jira = byProvider("jira");
    const linear = byProvider("linear");
    const backfilled = (i: { cursor: unknown } | undefined) =>
      (i?.cursor as { backfillCompletedAt?: string } | null)?.backfillCompletedAt != null;
    const zendeskReady = backfilled(zendesk);
    const intercomReady = backfilled(intercom);
    const jiraReady = backfilled(jira);
    const linearReady = backfilled(linear);

    // With no ticket source connected there is nothing to evaluate against
    // yet, so evaluation waits (reported as "zendesk", the historical name).
    const pendingProviders: SourceProvider[] = [];
    if (!zendesk && !intercom) pendingProviders.push("zendesk");
    if (zendesk && !zendeskReady) pendingProviders.push("zendesk");
    if (intercom && !intercomReady) pendingProviders.push("intercom");
    if (jira && !jiraReady) pendingProviders.push("jira");
    if (linear && !linearReady) pendingProviders.push("linear");

    // Ticket sources first: they create the Cases the trackers link onto.
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
    // No correlation step: Intercom is a ticket source that creates its own
    // Cases, and has no importable SLA policies (D9).
    const intercomResult =
      intercom && intercomReady ? { normalization: await runIntercomNormalization(prisma, intercom.id) } : null;

    const resolveCaseRef = jira || linear ? await caseRefResolverFor(prisma, organizationId) : null;
    const jiraResult =
      jira && jiraReady
        ? {
            correlation: await runJiraCorrelation(prisma, jira.id, resolveCaseRef),
            normalization: await runJiraNormalization(prisma, jira.id),
          }
        : null;
    const linearResult =
      linear && linearReady
        ? {
            correlation: await runLinearCorrelation(prisma, linear.id, resolveCaseRef),
            normalization: await runLinearNormalization(prisma, linear.id),
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
      intercom: intercomResult,
      jira: jiraResult,
      linear: linearResult,
      commitments,
      reResolution,
      nextReplyCycles,
      evaluation,
      pendingProviders,
    };
  });
}
