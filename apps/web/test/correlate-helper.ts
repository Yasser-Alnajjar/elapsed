import type { JiraCorrelationScope } from "@sla/jira";
import type { PrismaClient } from "@sla/db";

/**
 * Runs Jira correlation the way the worker does: with the resolver built from
 * the organization's connected ticket sources (Zendesk and Intercom). Modules
 * are imported lazily so a suite can set DATABASE_URL first.
 */
export async function correlateJira(prisma: PrismaClient, jiraIntegrationId: string, scope?: JiraCorrelationScope) {
  const [{ runJiraCorrelation }, { buildCaseRefResolver }, { recognizeZendeskTicketUrl }, { recognizeIntercomConversationUrl }] =
    await Promise.all([import("@sla/jira"), import("@sla/commitments"), import("@sla/zendesk"), import("@sla/intercom")]);
  const { organizationId } = await prisma.integration.findUniqueOrThrow({
    where: { id: jiraIntegrationId },
    select: { organizationId: true },
  });
  const resolver = await buildCaseRefResolver(prisma, organizationId, {
    zendesk: recognizeZendeskTicketUrl,
    intercom: recognizeIntercomConversationUrl,
  });
  return runJiraCorrelation(prisma, jiraIntegrationId, resolver, scope);
}
