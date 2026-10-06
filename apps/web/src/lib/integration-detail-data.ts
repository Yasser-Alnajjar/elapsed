import { countIntegrationData, type PrismaClient } from "@sla/db";
import { PROVIDERS } from "./providers";
import type {
  IntegrationDetailData,
  IntegrationProvider,
} from "./types/integrations";

/**
 * Assembles `/settings/integrations/[provider]`'s read model. Returns null
 * only for a provider that was never connected (no `Integration` row); the
 * caller (`Actions.Integrations.getDetail`) turns that into a 404. A
 * disconnected integration keeps its row, so it still gets a read model —
 * disconnect never makes the page inaccessible. Only display-only scalars derived from
 * `credentials`/`cursor` are returned — never the JSON blobs themselves,
 * which carry OAuth access/refresh tokens.
 */
export async function getIntegrationDetailData(
  prisma: PrismaClient,
  organizationId: string,
  provider: IntegrationProvider,
): Promise<IntegrationDetailData | null> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: {
      id: true,
      connectedAt: true,
      disconnectedAt: true,
      status: true,
      pollingPausedAt: true,
      lastSyncAt: true,
      lastSyncError: true,
      lastSuccessfulSyncAt: true,
      consecutiveFailures: true,
      failingSince: true,
      lastSyncDurationMs: true,
      webhookSecret: true,
      credentials: true,
      cursor: true,
    },
  });
  if (!integration) return null;

  const importedData = await countIntegrationData(prisma, organizationId, { id: integration.id, provider });

  // Null once disconnected — the credentials (and so the subdomain/repo
  // derived from them) are cleared, but the rest of the row remains.
  const credentials = (integration.credentials ?? {}) as {
    reauthRequired?: boolean;
    subdomain?: string;
    siteUrl?: string;
    owner?: string;
    repo?: string;
  };

  let siteSubdomain: string | undefined;
  if (credentials.siteUrl) {
    try {
      siteSubdomain = new URL(credentials.siteUrl).hostname.split(".")[0];
    } catch {
      siteSubdomain = undefined;
    }
  }
  const subdomain = credentials.subdomain ?? siteSubdomain;

  // `cursor` is a JSON column, so the timestamp is an ISO string at runtime.
  const cursor = integration.cursor as {
    backfillCompletedAt?: string | null;
  } | null;
  const backfillCompletedAt = cursor?.backfillCompletedAt
    ? new Date(cursor.backfillCompletedAt)
    : null;

  return {
    provider,
    integrationId: integration.id,
    connectedAt: integration.connectedAt,
    disconnected: integration.status === "disconnected",
    disconnectedAt: integration.disconnectedAt,
    importedData,
    reauthRequired: credentials.reauthRequired === true,
    permissionDenied: integration.status === "permission_denied",
    pollingPaused: integration.pollingPausedAt !== null,
    lastSyncAt: integration.lastSyncAt,
    lastSyncError: integration.lastSyncError,
    lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt,
    consecutiveFailures: integration.consecutiveFailures,
    failingSince: integration.failingSince,
    lastSyncDurationMs: integration.lastSyncDurationMs,
    backfillCompletedAt:
      backfillCompletedAt && !Number.isNaN(backfillCompletedAt.getTime())
        ? backfillCompletedAt
        : null,
    webhookSecret: integration.webhookSecret,
    webhooks: PROVIDERS[provider].capabilities.webhooks,
    subdomain,
    repo:
      provider === "github" && credentials.owner && credentials.repo
        ? `${credentials.owner}/${credentials.repo}`
        : undefined,
  };
}
