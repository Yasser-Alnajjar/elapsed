import "server-only";

import { getPrismaClient } from "@sla/db";

import { getRequestContext } from "@/lib/request-context";
import { getAtRiskData } from "@/lib/at-risk-data";
import type { AtRiskPageData, AtRiskParams } from "@/lib/types/at-risk";

export const AtRiskActions = {
  async getData(params: Partial<AtRiskParams> = {}): Promise<AtRiskPageData> {
    const { organizationId } = await getRequestContext();
    const prisma = getPrismaClient();

    return getAtRiskData(prisma, organizationId, params);
  },
};
