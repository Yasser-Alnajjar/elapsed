import { cache } from "react";
import { deriveWorkerStatus, getWorkerSettingsForRead, type PrismaClient } from "@sla/db";
import type { WorkerMonitoringData } from "./types/worker-settings";

/**
 * Assembles the operator Monitoring page's read model. Worker settings are
 * global (shared by every organization — see `@sla/db`'s `WorkerSettings`
 * doc comment), so unlike every other `*-data.ts` in this directory this
 * takes no `organizationId`. Callers must already have established that the
 * viewer is a platform operator (`isPlatformOperator` in `@/lib/authz`) —
 * this exposes operational diagnostics and does no authorization itself;
 * `canEdit` only decides whether the page renders the edit control.
 *
 * `React.cache`-wrapped so one request reads the singleton row once even if
 * several server components ask for it.
 */
/**
 * The active-poll interval alone, for the app-wide layout's sidebar footer.
 * Kept separate from `getWorkerMonitoringData` so the layout never touches
 * (or receives) worker status, timestamps or other operator diagnostics.
 */
export const getActivePollIntervalMs = cache(async function getActivePollIntervalMs(
  prisma: PrismaClient,
): Promise<number> {
  const settings = await getWorkerSettingsForRead(prisma);
  return settings.activePollIntervalMs;
});

export const getWorkerMonitoringData = cache(async function getWorkerMonitoringData(
  prisma: PrismaClient,
  canEdit: boolean,
): Promise<WorkerMonitoringData> {
  const settings = await getWorkerSettingsForRead(prisma);

  return {
    activePollIntervalMs: settings.activePollIntervalMs,
    reconciliationIntervalMs: settings.reconciliationIntervalMs,
    status: deriveWorkerStatus(settings),
    lastActivePollAt: settings.lastActivePollAt?.toISOString() ?? null,
    nextActivePollAt: settings.nextActivePollAt?.toISOString() ?? null,
    lastReconciliationAt: settings.lastReconciliationAt?.toISOString() ?? null,
    nextReconciliationAt: settings.nextReconciliationAt?.toISOString() ?? null,
    canEdit,
  };
});
