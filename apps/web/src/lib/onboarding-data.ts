import type { PrismaClient } from "@sla/db";
import { getIntegrationConfigStatus } from "@sla/db";
import type { ZendeskCredentials, ZendeskCursor } from "@sla/zendesk";
import type { JiraCredentials, JiraCursor } from "@sla/jira";
import type { OnboardingStatus } from "./types/onboarding";

/**
 * Cheap counts for the onboarding progress view (roadmap step 11). Reads
 * `RawEvent`/`Case`/`CaseLink` counts directly rather than running the SLA
 * engine — this is polled every few seconds while backfill is in flight, so
 * it has to stay fast, and "how many rows landed so far" is all a progress
 * view needs.
 */
export async function getOnboardingStatus(
  prisma: PrismaClient,
  organizationId: string,
): Promise<OnboardingStatus> {
  const [
    zendeskIntegration,
    jiraIntegration,
    ticketsFetched,
    escalatedCases,
    linkedIssues,
    zendeskConfig,
    jiraConfig,
    linearConfig,
    githubConfig,
  ] = await Promise.all([
    prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "zendesk" } },
    }),
    prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "jira" } },
    }),
    prisma.rawEvent.count({
      where: { integration: { organizationId, provider: "zendesk" }, providerEventId: { startsWith: "ticket:" } },
    }),
    prisma.case.count({ where: { organizationId, deletedAt: null, caseLinks: { some: { system: "jira" } } } }),
    prisma.caseLink.count({ where: { case: { organizationId }, system: "jira" } }),
    getIntegrationConfigStatus(prisma, organizationId, "zendesk"),
    getIntegrationConfigStatus(prisma, organizationId, "jira"),
    getIntegrationConfigStatus(prisma, organizationId, "linear"),
    getIntegrationConfigStatus(prisma, organizationId, "github"),
  ]);

  const zendeskCredentials = (zendeskIntegration?.credentials as ZendeskCredentials | null) ?? null;
  const zendeskCursor = (zendeskIntegration?.cursor as ZendeskCursor | null) ?? null;
  const jiraCredentials = (jiraIntegration?.credentials as JiraCredentials | null) ?? null;
  const jiraCursor = (jiraIntegration?.cursor as JiraCursor | null) ?? null;

  return {
    zendesk: {
      connected: zendeskIntegration !== null,
      backfillComplete: zendeskCursor?.backfillCompletedAt != null,
      reauthRequired: zendeskCredentials?.reauthRequired === true,
    },
    jira: {
      connected: jiraIntegration !== null,
      backfillComplete: jiraCursor?.backfillCompletedAt != null,
      reauthRequired: jiraCredentials?.reauthRequired === true,
    },
    zendeskConfig,
    jiraConfig,
    linearConfig,
    githubConfig,
    ticketsFetched,
    escalatedCases,
    linkedIssues,
  };
}
