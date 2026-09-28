import "server-only";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { getDashboardData } from "@/lib/dashboard-data";
import type { DashboardData } from "@/lib/types/dashboard";

export const DashboardActions = {
  async getData(): Promise<DashboardData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    return getDashboardData(prisma, organizationId);
  },
};
