import type { PrismaClient } from "@sla/db";
import { PROVIDERS } from "./providers";
import type {
  IntegrationDetailData,
  IntegrationProvider,
} from "./types/integrations";

/**
 * Assembles `/settings/integrations/[provider]`'s read model. Returns null
 * for a provider that was never connected, or whose credentials were
 * cleared by a disconnect — either way there's nothing to manage, and the
 * caller (`Actions.Integrations.getDetail`) turns that into a 404 rather
 * than rendering an empty page. Only display-only scalars derived from
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
      status: true,
      lastSyncAt: true,
      lastSyncError: true,
      webhookSecret: true,
      credentials: true,
      cursor: true,
    },
  });
  if (!integration || !integration.credentials) return null;

  const credentials = integration.credentials as {
    reauthRequired?: boolean;
    subdomain?: string;
    siteUrl?: string;
    owner?: string;
    repo?: string;
  };

  const subdomain =
    credentials.subdomain ??
    (credentials.siteUrl
      ? new URL(credentials.siteUrl).hostname.split(".")[0]
      : undefined);

  const cursor = integration.cursor as {
    backfillCompletedAt?: Date | null;
  } | null;

  return {
    provider,
    integrationId: integration.id,
    connectedAt: integration.connectedAt,
    reauthRequired: credentials.reauthRequired === true,
    permissionDenied: integration.status === "permission_denied",
    lastSyncAt: integration.lastSyncAt,
    lastSyncError: integration.lastSyncError,
    backfillCompletedAt: cursor?.backfillCompletedAt ?? null,
    webhookSecret: integration.webhookSecret,
    webhooks: PROVIDERS[provider].capabilities.webhooks,
    subdomain,
    repo:
      provider === "github" && credentials.owner && credentials.repo
        ? `${credentials.owner}/${credentials.repo}`
        : undefined,
  };
}
