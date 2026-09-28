import "server-only";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { isPlatformOperator } from "@/lib/authz";
import { getWorkerMonitoringData } from "@/lib/worker-settings-data";
import type { WorkerMonitoringData } from "@/lib/types/worker-settings";

export const WorkerSettingsActions = {
  async getData(): Promise<WorkerMonitoringData> {
    const { session } = await getRequestContext();

    const prisma = getPrismaClient();
    return getWorkerMonitoringData(prisma, isPlatformOperator(session));
  },
};
