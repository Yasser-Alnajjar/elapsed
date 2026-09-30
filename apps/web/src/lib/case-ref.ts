import { buildCaseRefResolver, type CaseRefResolver } from "@sla/commitments";
import type { PrismaClient } from "@sla/db";
import { recognizeIntercomConversationUrl } from "@sla/intercom";
import { recognizeZendeskTicketUrl } from "@sla/zendesk";

/**
 * Which ticket sources a Jira remote link or Linear attachment may point at,
 * and how each one recognizes its own URLs. N2 replaces this static map with
 * the adapter registry.
 */
const TICKET_URL_RECOGNIZERS = {
  zendesk: recognizeZendeskTicketUrl,
  intercom: recognizeIntercomConversationUrl,
};

/** The resolver the trackers' correlators take (N1.13); `null` when the organization has no connected ticket source. */
export function caseRefResolverFor(prisma: PrismaClient, organizationId: string): Promise<CaseRefResolver | null> {
  return buildCaseRefResolver(prisma, organizationId, TICKET_URL_RECOGNIZERS);
}
