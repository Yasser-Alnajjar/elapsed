import "server-only";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { getSlaConfigurationData } from "@/lib/sla-configuration-data";
import type { SlaConfigurationData } from "@/lib/types/sla-configuration";

export const SlaConfigurationActions = {
  async getData(): Promise<SlaConfigurationData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    return getSlaConfigurationData(prisma, organizationId);
  },
};
