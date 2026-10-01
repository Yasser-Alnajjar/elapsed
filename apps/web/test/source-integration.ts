import type { IntegrationProvider, PrismaClient } from "@sla/db";

/**
 * The integration a test case names as its source (`Case.sourceIntegrationId`
 * is required since N2.10), created bare when the suite has not made one.
 */
export async function sourceIntegration(
  prisma: PrismaClient,
  organizationId: string,
  provider: IntegrationProvider = "zendesk",
): Promise<string> {
  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { id: true },
  });
  if (existing) return existing.id;
  return (await prisma.integration.create({ data: { organizationId, provider, credentials: {} }, select: { id: true } })).id;
}
