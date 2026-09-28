import "server-only";
import { notFound } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { getIntegrationDetailData } from "@/lib/integration-detail-data";
import { getIntegrationsData } from "@/lib/integrations-data";
import { isIntegrationProvider, type IntegrationDetailData, type IntegrationsPageData } from "@/lib/types/integrations";

export const IntegrationsActions = {
  async getData(): Promise<IntegrationsPageData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    return getIntegrationsData(prisma, organizationId);
  },

  async getDetail(provider: string): Promise<IntegrationDetailData> {
    const { organizationId } = await getRequestContext();
    if (!isIntegrationProvider(provider)) notFound();

    const prisma = getPrismaClient();
    const data = await getIntegrationDetailData(prisma, organizationId, provider);
    if (!data) notFound();
    return data;
  },
};
