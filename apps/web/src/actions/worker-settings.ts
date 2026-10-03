import "server-only";
import { notFound } from "next/navigation";
import { getPrismaClient } from "@sla/db";
import { getRequestContext } from "@/lib/request-context";
import { isPlatformOperator } from "@/lib/authz";
import { getActivePollIntervalMs, getWorkerMonitoringData } from "@/lib/worker-settings-data";
import type { WorkerMonitoringData } from "@/lib/types/worker-settings";

export const WorkerSettingsActions = {
  /**
   * Full worker/Monitoring diagnostics — platform operators only.
   * `notFound()` before anything is queried, the same convention as
   * `OperatorActions.getData`: this route doesn't exist for a tenant.
   */
  async getMonitoringData(): Promise<WorkerMonitoringData> {
    const { session } = await getRequestContext();
    if (!isPlatformOperator(session)) notFound();

    const prisma = getPrismaClient();
    return getWorkerMonitoringData(prisma, true);
  },

  /**
   * The one non-sensitive worker value a tenant page shows (the dashboard's
   * "Auto-Sync: Ns" readout). Deliberately exposes nothing else about the
   * worker — see `getMonitoringData` for the operator-only diagnostics.
   */
  async getActivePollIntervalMs(): Promise<number> {
    const prisma = getPrismaClient();
    return getActivePollIntervalMs(prisma);
  },
};
