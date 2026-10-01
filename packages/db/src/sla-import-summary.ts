import type { IntegrationProvider, PrismaClient } from "../generated/prisma/client";

/** Import coverage for one organization's latest SLA policy import + commitment pass (Phase 1.12 / E-8, E-16). */
export interface SlaImportSummaryInput {
  /** The provider whose policy import this summarises (the one with the `policyImport` capability). */
  provider: IntegrationProvider;
  unsupportedConditions: number;
  unsupportedMetrics: number;
  policiesWithNoUsableTargets: number;
  policiesWithUnresolvedSchedule: number;
  policiesArchived: number;
  casesWithNoMatchingPolicy: number;
}

/**
 * Overwrites the one `SlaImportSummary` row for `organizationId` with this
 * run's coverage — a snapshot of the latest import, not a history. Called
 * after both a provider's policy import and `runCommitmentPipeline` have
 * run for the organization (the worker cycle and the onboarding/webhook
 * source-sync tail both call it), so the numbers describe one consistent
 * pass rather than two pipelines' results from different points in time.
 */
export async function recordSlaImportSummary(
  prisma: PrismaClient,
  organizationId: string,
  input: SlaImportSummaryInput,
): Promise<void> {
  const data = {
    provider: input.provider,
    unsupportedConditions: input.unsupportedConditions,
    unsupportedMetrics: input.unsupportedMetrics,
    policiesWithNoUsableTargets: input.policiesWithNoUsableTargets,
    policiesWithUnresolvedSchedule: input.policiesWithUnresolvedSchedule,
    policiesArchived: input.policiesArchived,
    casesWithNoMatchingPolicy: input.casesWithNoMatchingPolicy,
  };
  await prisma.slaImportSummary.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });
}
