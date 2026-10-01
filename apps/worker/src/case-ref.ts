import { buildCaseRefResolver, type CaseRefResolver } from "@sla/commitments";
import type { PrismaClient } from "@sla/db";
import { ticketUrlRecognizers } from "@sla/ingestion";
import { PROVIDERS } from "./providers";

/**
 * The resolver the trackers' correlators take (N1.13), built from the
 * registry's ticket-source adapters (`recognizeCaseUrl`); `null` when the
 * organization has no connected ticket source.
 */
export function caseRefResolverFor(prisma: PrismaClient, organizationId: string): Promise<CaseRefResolver | null> {
  return buildCaseRefResolver(prisma, organizationId, ticketUrlRecognizers(PROVIDERS));
}
