import "server-only";

import { getPrismaClient } from "@sla/db";

import { getRequestContext } from "@/lib/request-context";
import { getAtRiskData } from "@/lib/at-risk-data";
import type { AtRiskRowData } from "@/lib/types/at-risk";

export const AtRiskActions = {
  async getData(): Promise<AtRiskRowData[]> {
    const { organizationId } = await getRequestContext();
    const prisma = getPrismaClient();

    return getAtRiskData(prisma, organizationId);
  },
};
