import {
  listIntegrationDataOperations,
  listIntegrationDataSummaries,
  totalIntegrationDataRecords,
  type IntegrationDataCounts,
  type PrismaClient,
} from "@sla/db";
import type { DataOperationRow, DataPageData } from "./types/data";

/** Records covered, from an operation's stored `details.scope` — counts only, never content. */
function recordsOf(details: unknown): number | null {
  const scope = (details as { scope?: Partial<IntegrationDataCounts> } | null)?.scope;
  if (!scope || typeof scope !== "object") return null;
  return totalIntegrationDataRecords({
    rawEvents: 0,
    cases: 0,
    normalizedEvents: 0,
    commitments: 0,
    evaluations: 0,
    caseLinks: 0,
    customerIdentities: 0,
    other: 0,
    ...scope,
  });
}

/**
 * Assembles `/settings/data`'s read model. Lists every integration that holds
 * stored data, whatever its connection state: disconnect keeps the row and its
 * data, so a disconnected integration stays here until it is cleaned up.
 * Counts are aggregate `count` queries (see `countIntegrationData`).
 */
export async function getDataPageData(
  prisma: PrismaClient,
  organizationId: string,
  canManage: boolean,
): Promise<DataPageData> {
  const [summaries, operations] = await Promise.all([
    listIntegrationDataSummaries(prisma, organizationId),
    listIntegrationDataOperations(prisma, organizationId),
  ]);

  return {
    canManage,
    integrations: summaries
      .filter((summary) => summary.total > 0)
      .map(({ lastSyncError: _lastSyncError, ...row }) => row),
    operations: operations.map(
      (operation): DataOperationRow => ({
        id: operation.id,
        provider: operation.provider,
        kind: operation.kind,
        format: (operation.details as { format?: string } | null)?.format ?? null,
        status: operation.status,
        actorEmail: operation.actorEmail,
        startedAt: operation.startedAt,
        finishedAt: operation.finishedAt,
        records: recordsOf(operation.details),
        error: operation.error,
      }),
    ),
  };
}
