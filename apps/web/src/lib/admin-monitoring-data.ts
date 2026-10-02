import { getWorkerSettingsForRead, type PrismaClient } from "@sla/db";
import { staleFields } from "./freshness-data";
import type {
  OperatorFailedAlertRow,
  OperatorHealthyIntegrationRow,
  OperatorIntegrationHealthRow,
  OperatorMonitoringData,
} from "./types/operator";
import type { IntegrationProvider } from "./types/integrations";

// Same cap/overflow convention as the org-scoped dashboard's Blind Spots
// panel (`FAILED_ALERTS_LIMIT` in dashboard-data.ts) — readable on one
// screen even on a deployment with many organizations.
const FAILED_ALERTS_LIMIT = 25;

/** How many healthy integrations to list; the page shows the true total next to them. */
const HEALTHY_INTEGRATIONS_LIMIT = 24;

/**
 * Cross-organization read model for the platform-operator monitoring view
 * (roadmap 7.5) — the operator equivalent of `getDashboardData`'s Blind
 * Spots panel (Phase 6.3/6.4), except unscoped to one `organizationId` and
 * restricted to *unhealthy* integrations only (a fine integration on every
 * one of N organizations would otherwise swamp the page). Callers must
 * confirm `isPlatformOperator(session)` before calling this — it is the
 * only data function in the app that reads across tenants.
 */
export async function getOperatorMonitoringData(
  prisma: PrismaClient,
): Promise<OperatorMonitoringData> {
  const asOfDate = new Date();
  const asOf = asOfDate.toISOString();
  const workerSettings = await getWorkerSettingsForRead(prisma);
  const staleCutoff = new Date(
    asOfDate.getTime() - workerSettings.activePollIntervalMs * workerSettings.freshnessGraceFactor,
  );

  const [organizationCount, unhealthyIntegrationRows, failedNotificationRows] =
    await Promise.all([
      prisma.organization.count(),
      prisma.integration.findMany({
        where: {
          OR: [
            { status: { in: ["reauth_required", "permission_denied"] } },
            { lastSyncError: { not: null } },
            { failingSince: { not: null } },
            // Stale with no recorded error (e.g. the worker stopped): N3.9.
            {
              status: { not: "disconnected" },
              OR: [{ lastSuccessfulSyncAt: null }, { lastSuccessfulSyncAt: { lt: staleCutoff } }],
            },
          ],
        },
        select: {
          id: true,
          organizationId: true,
          organization: { select: { name: true } },
          provider: true,
          status: true,
          lastSyncAt: true,
          lastSyncError: true,
          lastSuccessfulSyncAt: true,
          consecutiveFailures: true,
          failingSince: true,
          lastSyncDurationMs: true,
          pollingPausedAt: true,
        },
        orderBy: { lastSyncAt: "desc" },
      }),
      prisma.notificationFailure.findMany({
        include: {
          commitment: {
            include: {
              case: {
                select: {
                  id: true,
                  externalId: true,
                  subject: true,
                  organizationId: true,
                  organization: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { lastFailedAt: "desc" },
      }),
    ]);

  // The healthy ones are everything connected that is not in the unhealthy list.
  const unhealthyIds = unhealthyIntegrationRows.map((row) => row.id);
  const [connectedIntegrationCount, healthyIntegrationRows] = await Promise.all([
    prisma.integration.count({ where: { status: { not: "disconnected" } } }),
    prisma.integration.findMany({
      where: { status: { not: "disconnected" }, id: { notIn: unhealthyIds } },
      select: {
        organizationId: true,
        organization: { select: { name: true } },
        provider: true,
        lastSuccessfulSyncAt: true,
      },
      orderBy: [{ lastSuccessfulSyncAt: "desc" }, { id: "asc" }],
      take: HEALTHY_INTEGRATIONS_LIMIT,
    }),
  ]);
  const unhealthyConnectedCount = unhealthyIntegrationRows.filter((row) => row.status !== "disconnected").length;

  const unhealthyIntegrations: OperatorIntegrationHealthRow[] = unhealthyIntegrationRows.map(
    (row) => ({
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      provider: row.provider as IntegrationProvider,
      reauthRequired: row.status === "reauth_required",
      permissionDenied: row.status === "permission_denied",
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastSyncError: row.lastSyncError,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
      consecutiveFailures: row.consecutiveFailures,
      failingSince: row.failingSince?.toISOString() ?? null,
      lastSyncDurationMs: row.lastSyncDurationMs,
      pollingPausedAt: row.pollingPausedAt?.toISOString() ?? null,
      ...staleFields(row, asOf, workerSettings),
    }),
  );

  const failedAlerts: OperatorFailedAlertRow[] = failedNotificationRows
    .filter(
      (row): row is typeof row & { commitment: NonNullable<(typeof row)["commitment"]> & { case: NonNullable<(typeof row)["commitment"]["case"]> } } =>
        row.commitment?.case != null,
    )
    .slice(0, FAILED_ALERTS_LIMIT)
    .map((row) => ({
      organizationId: row.commitment.case.organizationId,
      organizationName: row.commitment.case.organization?.name ?? null,
      commitmentId: row.commitmentId,
      caseId: row.commitment.case.id,
      externalId: row.commitment.case.externalId,
      subject: row.commitment.case.subject,
      kind: row.commitment.kind,
      threshold: row.threshold,
      error: row.error,
      attempts: row.attempts,
      firstFailedAt: row.firstFailedAt.toISOString(),
      lastFailedAt: row.lastFailedAt.toISOString(),
    }));

  const healthyIntegrations: OperatorHealthyIntegrationRow[] = healthyIntegrationRows.map((row) => ({
    organizationId: row.organizationId,
    organizationName: row.organization?.name ?? null,
    provider: row.provider as IntegrationProvider,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
  }));

  return {
    asOf,
    organizationCount,
    unhealthyIntegrations,
    failedAlerts,
    failedAlertsOverflowCount: Math.max(0, failedNotificationRows.length - FAILED_ALERTS_LIMIT),
    connectedIntegrationCount,
    healthyIntegrationCount: Math.max(0, connectedIntegrationCount - unhealthyConnectedCount),
    healthyIntegrations,
  };
}
