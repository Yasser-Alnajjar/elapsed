import "server-only";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { dashboardHasData, getDashboardData } from "@/lib/dashboard-data";
import { recordFirstFindingsViewed } from "@/lib/usage-tracking";
import type { DashboardData } from "@/lib/types/dashboard";

export const DashboardActions = {
  async getData(): Promise<DashboardData> {
    const { organizationId } = await getRequestContext();

    const prisma = getPrismaClient();
    const data = await getDashboardData(prisma, organizationId);
    // Time to first value (N5.7): the dashboard counts once there is something on it.
    if (dashboardHasData(data)) void recordFirstFindingsViewed(prisma, organizationId);
    return data;
  },
};
