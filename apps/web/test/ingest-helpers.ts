/**
 * Runs the ingestion pipeline the way the worker does, for suites that seed
 * raw events directly: derive a provider's batch or links, project them, and
 * report the counters the pre-N2.3 `run*` functions returned. Modules are
 * imported lazily so a suite can set DATABASE_URL first.
 */
import type { IntegrationProvider, PrismaClient } from "@sla/db";
import type { CorrelationProjection, IntegrationRef, ProjectionResult } from "@sla/ingestion";

async function refOf(prisma: PrismaClient, integrationId: string): Promise<IntegrationRef> {
  const row = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  return { id: row.id, organizationId: row.organizationId, provider: row.provider, status: row.status };
}

async function adapterFor(provider: IntegrationProvider) {
  const { PROVIDERS } = await import("@/lib/providers");
  return PROVIDERS[provider];
}

/** Normalizes one integration's raw events and projects the batch; `externalIds` narrows to those source records. */
export async function normalizeIntegration(
  prisma: PrismaClient,
  integrationId: string,
  scope: { mode?: "incremental" | "full"; externalIds?: string[] } = {},
): Promise<ProjectionResult> {
  const ref = await refOf(prisma, integrationId);
  const { normalizeAndProject } = await import("@sla/ingestion");
  return normalizeAndProject(await adapterFor(ref.provider), { prisma, integration: ref, mode: scope.mode ?? "full", externalIds: scope.externalIds });
}

export const normalizeZendesk = (
  prisma: PrismaClient,
  integrationId: string,
  scope: { mode?: "incremental" | "full"; ticketIds?: number[] } = {},
) => normalizeIntegration(prisma, integrationId, { mode: scope.mode, externalIds: scope.ticketIds?.map(String) });

export const normalizeJira = (prisma: PrismaClient, integrationId: string, scope: { issueKeys?: string[] } = {}) =>
  normalizeIntegration(prisma, integrationId, { externalIds: scope.issueKeys });

/** The counters the correlators used to return, named as they were. */
export interface LegacyCorrelationCounts {
  caseLinksCreated: number;
  caseLinksReactivated: number;
  caseLinksUnlinked: number;
  remoteLinksEvaluated: number;
  officialLinksEvaluated: number;
  attachmentsEvaluated: number;
  pullRequestsEvaluated: number;
  unmatchedUnrecognizedUrl: number;
  unmatchedNoCase: number;
  unmatchedInvalidRecord: number;
}

function legacyCounts(p: CorrelationProjection | null): LegacyCorrelationCounts {
  return {
    caseLinksCreated: p?.created ?? 0,
    caseLinksReactivated: p?.reactivated ?? 0,
    caseLinksUnlinked: p?.unlinked ?? 0,
    remoteLinksEvaluated: p?.evaluated ?? 0,
    officialLinksEvaluated: p?.evaluated ?? 0,
    attachmentsEvaluated: p?.evaluated ?? 0,
    pullRequestsEvaluated: p?.evaluated ?? 0,
    unmatchedUnrecognizedUrl: p?.unmatched.unrecognizedUrl ?? 0,
    unmatchedNoCase: p?.unmatched.noCase ?? 0,
    unmatchedInvalidRecord: p?.unmatched.invalidRecord ?? 0,
  };
}

/**
 * Correlates one integration and projects its links, with the resolver built
 * from the organization's connected ticket sources, as the worker does.
 * `externalIds` narrows to those issues (a webhook delivery).
 */
export async function correlateIntegration(prisma: PrismaClient, integrationId: string, scope: { externalIds?: string[] } = {}) {
  const ref = await refOf(prisma, integrationId);
  const [{ correlateAndProject }, { caseRefResolverFor }] = await Promise.all([import("@sla/ingestion"), import("@/lib/case-ref")]);
  return legacyCounts(
    await correlateAndProject(await adapterFor(ref.provider), {
      prisma,
      integration: ref,
      resolveCaseRef: await caseRefResolverFor(prisma, ref.organizationId),
      externalIds: scope.externalIds,
    }),
  );
}

export const correlateJira = (prisma: PrismaClient, integrationId: string, scope: { issueKey?: string } = {}) =>
  correlateIntegration(prisma, integrationId, { externalIds: scope.issueKey ? [scope.issueKey] : undefined });

/** Zendesk's official Jira links: needs no ticket-URL resolver. */
export const correlateZendeskLinks = (prisma: PrismaClient, integrationId: string) => correlateIntegration(prisma, integrationId);

/** A `jira:issue_deleted` delivery: records the deletion and ends every active link to the issue. */
export async function unlinkJiraIssue(prisma: PrismaClient, jiraIntegrationId: string, issueKey: string): Promise<void> {
  const [{ recordJiraIssueDeletion }, { projectIssueRemoval }] = await Promise.all([import("@sla/jira"), import("@sla/ingestion")]);
  const removal = await recordJiraIssueDeletion(prisma, jiraIntegrationId, issueKey);
  if (removal) await projectIssueRemoval(prisma, removal);
}
