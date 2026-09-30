import type { PrismaClient } from "@sla/db";
import { getIntegrationConfigStatus } from "@sla/db";
import type { OnboardingStatus, ProviderOnboardingStatus } from "./types/onboarding";

const TRACKERS: ("jira" | "linear")[] = ["jira", "linear"];

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
    intercomIntegration,
    jiraIntegration,
    linearIntegration,
    zendeskTickets,
    intercomConversations,
    escalatedCases,
    linkedIssues,
    zendeskConfig,
    intercomConfig,
    jiraConfig,
    linearConfig,
    githubConfig,
  ] = await Promise.all([
    integration("zendesk"),
    integration("intercom"),
    integration("jira"),
    integration("linear"),
    prisma.rawEvent.count({
      where: { integration: { organizationId, provider: "zendesk" }, providerEventId: { startsWith: "ticket:" } },
    }),
    prisma.rawEvent.count({
      where: { integration: { organizationId, provider: "intercom" }, providerEventId: { startsWith: "conversation:" } },
    }),
    prisma.case.count({ where: { organizationId, deletedAt: null, caseLinks: { some: { system: { in: TRACKERS } } } } }),
    prisma.caseLink.count({ where: { case: { organizationId }, system: { in: TRACKERS } } }),
    getIntegrationConfigStatus(prisma, organizationId, "zendesk"),
    getIntegrationConfigStatus(prisma, organizationId, "intercom"),
    getIntegrationConfigStatus(prisma, organizationId, "jira"),
    getIntegrationConfigStatus(prisma, organizationId, "linear"),
    getIntegrationConfigStatus(prisma, organizationId, "github"),
  ]);

  function integration(provider: "zendesk" | "intercom" | "jira" | "linear") {
    return prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
  }

  const provider = (
    row: typeof zendeskIntegration,
  ): ProviderOnboardingStatus => {
    const credentials = row?.credentials as { reauthRequired?: boolean } | null | undefined;
    const cursor = row?.cursor as { backfillCompletedAt?: string } | null | undefined;
    return {
      connected: row !== null,
      backfillComplete: cursor?.backfillCompletedAt != null,
      reauthRequired: credentials?.reauthRequired === true,
    };
  };

  return {
    zendesk: provider(zendeskIntegration),
    intercom: provider(intercomIntegration),
    jira: provider(jiraIntegration),
    linear: provider(linearIntegration),
    zendeskConfig,
    intercomConfig,
    jiraConfig,
    linearConfig,
    githubConfig,
    ticketsFetched: zendeskTickets + intercomConversations,
    escalatedCases,
    linkedIssues,
  };
}
