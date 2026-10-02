import { assessFreshness } from "@sla/core";
import { getWorkerSettingsForRead, type PrismaClient } from "@sla/db";
import { INTEGRATION_PROVIDER_LABELS, type IntegrationProvider } from "./types/integrations";

/** Small layout read-model: only integrations currently stale for this tenant. */
export async function getStaleIntegrationData(prisma: PrismaClient, organizationId: string) {
  const [settings, integrations] = await Promise.all([
    getWorkerSettingsForRead(prisma),
    prisma.integration.findMany({
      where: { organizationId, status: { not: "disconnected" } },
      select: { provider: true, lastSuccessfulSyncAt: true },
    }),
  ]);
  const asOf = new Date().toISOString();
  return integrations.flatMap((integration) => {
    const { staleSince } = assessFreshness({
      lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt,
      asOf,
      expectedIntervalMs: settings.activePollIntervalMs,
      graceFactor: settings.freshnessGraceFactor,
    });
    if (!staleSince) return [];
    return [
      {
        provider: INTEGRATION_PROVIDER_LABELS[integration.provider as IntegrationProvider],
        // assessFreshness reports "now" for a never-synced source; showing that
        // as "stale since" would tick forward on every render.
        staleSince: integration.lastSuccessfulSyncAt ? staleSince : null,
      },
    ];
  });
}

/**
 * `stale` / `staleSince` for an integration row, from the worker's own
 * cadence. `staleSince` is null when the integration has never synced
 * successfully (`assessFreshness` would report "now", which changes on every
 * render). A disconnected integration is never stale: it is not expected to sync.
 */
export function staleFields(
  row: { status: string; lastSuccessfulSyncAt: Date | null },
  asOf: string,
  settings: { activePollIntervalMs: number; freshnessGraceFactor: number },
): { stale: boolean; staleSince: string | null } {
  if (row.status === "disconnected") return { stale: false, staleSince: null };
  const { fresh, staleSince } = assessFreshness({
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
    asOf,
    expectedIntervalMs: settings.activePollIntervalMs,
    graceFactor: settings.freshnessGraceFactor,
  });
  return { stale: !fresh, staleSince: row.lastSuccessfulSyncAt ? staleSince : null };
}
