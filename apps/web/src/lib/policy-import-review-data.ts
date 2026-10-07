import { CASE_SOURCE_CONNECTED, type PrismaClient } from "@sla/db";
import { providersWithCapability } from "./providers";
import { getSlaPolicies } from "./sla-policies-data";
import { INTEGRATION_PROVIDER_LABELS } from "./types/integrations";
import type { PolicyImportReview } from "./types/onboarding";

const UNMATCHED_CASES_LIMIT = 10;

/**
 * Assembles the onboarding "review your imported policies" screen (Phase
 * 6.7): Imported / Matched / No match / Warnings, from `SlaImportSummary`
 * (Phase 1.12) plus a live read of which open cases currently have no
 * matching policy — the same query the dashboard's Blind Spots panel uses
 * (Phase 6.2), so the two never disagree.
 */
export async function getPolicyImportReview(
  prisma: PrismaClient,
  organizationId: string,
): Promise<PolicyImportReview> {
  const importers = providersWithCapability("policyImport");
  const [policies, summary, totalOpenCases, unmatchedCaseRows, importerRow] = await Promise.all([
    getSlaPolicies(prisma, organizationId),
    // The summary of the last policy import by a provider that has one (the
    // `policyImport` capability); a row stamped with no provider is not any
    // provider's summary.
    prisma.slaImportSummary.findFirst({
      where: { organizationId, provider: { in: importers } },
    }),
    prisma.case.count({ where: { organizationId, deletedAt: null, ...CASE_SOURCE_CONNECTED, closedAt: null } }),
    prisma.case.findMany({
      where: { organizationId, deletedAt: null, ...CASE_SOURCE_CONNECTED, closedAt: null, commitments: { none: {} } },
      select: { id: true, externalId: true, subject: true, openedAt: true, customer: { select: { name: true } } },
      orderBy: { openedAt: "asc" },
    }),
    prisma.integration.findFirst({
      where: { organizationId, provider: { in: importers }, status: { not: "disconnected" } },
      select: { provider: true },
    }),
  ]);

  const importedPolicies = policies.filter((p) => p.source === "imported" && p.active);
  const unmatchedCaseCount = unmatchedCaseRows.length;

  return {
    importedPolicies,
    matchedCaseCount: Math.max(0, totalOpenCases - unmatchedCaseCount),
    unmatchedCaseCount,
    unmatchedCases: unmatchedCaseRows.slice(0, UNMATCHED_CASES_LIMIT).map((row) => ({
      caseId: row.id,
      externalId: row.externalId,
      subject: row.subject,
      customerName: row.customer?.name ?? null,
      openedAt: row.openedAt.toISOString(),
    })),
    unmatchedOverflowCount: Math.max(0, unmatchedCaseCount - UNMATCHED_CASES_LIMIT),
    warnings: {
      unsupportedConditions: summary?.unsupportedConditions ?? 0,
      unsupportedMetrics: summary?.unsupportedMetrics ?? 0,
      policiesWithNoUsableTargets: summary?.policiesWithNoUsableTargets ?? 0,
      policiesWithUnresolvedSchedule: summary?.policiesWithUnresolvedSchedule ?? 0,
      policiesArchived: summary?.policiesArchived ?? 0,
    },
    lastImportAt: summary?.updatedAt.toISOString() ?? null,
    sourceLabel: importerRow ? INTEGRATION_PROVIDER_LABELS[importerRow.provider] : "your helpdesk",
  };
}
