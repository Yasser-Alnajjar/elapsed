import "server-only";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { listAuthorizedOrganizations, listSourceIntegrations } from "@/lib/concierge-access";
import type { ConciergeExportPageData, ConciergeSourceProvider } from "@/lib/types/concierge-export";

export const ConciergeActions = {
  async getExportData(provider: ConciergeSourceProvider): Promise<ConciergeExportPageData> {
    const { session } = await getRequestContext();

    const prisma = getPrismaClient();
    const organizations = await listAuthorizedOrganizations(prisma, session);
    // With a single organization it's preselected, so its integrations ship with the page.
    const initialOrganizationId = organizations.length === 1 ? organizations[0]!.id : null;
    const initialIntegrations = initialOrganizationId
      ? await listSourceIntegrations(prisma, initialOrganizationId, provider)
      : [];

    return { provider, organizations, initialOrganizationId, initialIntegrations };
  },
};
