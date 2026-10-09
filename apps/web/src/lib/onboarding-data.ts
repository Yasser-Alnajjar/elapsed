import type { PrismaClient } from "@sla/db";
import {
  CASE_SOURCE_CONNECTED,
  RAW_EVENT_SOURCE_CONNECTED,
  SYSTEM_SOURCE_CONNECTED,
  getIntegrationConfigStatus,
} from "@sla/db";
import { INTEGRATION_PROVIDER_LABELS, type IntegrationProvider, type OAuthIntegrationProvider } from "./types/integrations";
import type { OnboardingStatus, ProviderOnboardingStatus } from "./types/onboarding";
import { PROVIDERS, WEB_PROVIDERS, WORK_TRACKER_PROVIDERS, TICKET_SOURCE_PROVIDERS } from "./providers";

// `custom` has no OAuth app and its own wizard, so the guided onboarding flow does not offer it (N9, V1).
const REGISTRY_ORDER = (Object.keys(PROVIDERS) as IntegrationProvider[]).filter(
  (provider): provider is OAuthIntegrationProvider => provider !== "custom",
);

/**
 * Cheap counts for the onboarding progress view (roadmap step 11). Reads
 * `RawEvent`/`Case`/`CaseLink` counts directly rather than running the SLA
 * engine: this is polled every few seconds while backfill is in flight, so
 * it has to stay fast, and "how many rows landed so far" is all a progress
 * view needs. Built from the adapter registry (N5.1): a provider added to it
 * appears here with no change.
 */
export async function getOnboardingStatus(prisma: PrismaClient, organizationId: string): Promise<OnboardingStatus> {
  const [rows, configs, ticketsFetched, escalatedCases, linkedIssues] = await Promise.all([
    prisma.integration.findMany({ where: { organizationId } }),
    Promise.all(REGISTRY_ORDER.map((provider) => getIntegrationConfigStatus(prisma, organizationId, provider))),
    countSnapshots(prisma, organizationId),
    prisma.case.count({
      where: {
        organizationId,
        deletedAt: null,
        ...CASE_SOURCE_CONNECTED,
        caseLinks: { some: { system: { in: WORK_TRACKER_PROVIDERS }, ...SYSTEM_SOURCE_CONNECTED } },
      },
    }),
    prisma.caseLink.count({
      where: { case: { organizationId, ...CASE_SOURCE_CONNECTED }, system: { in: WORK_TRACKER_PROVIDERS }, ...SYSTEM_SOURCE_CONNECTED },
    }),
  ]);

  const providers = REGISTRY_ORDER.map((provider, index): ProviderOnboardingStatus => {
    const row = rows.find((r) => r.provider === provider);
    const credentials = row?.credentials as { reauthRequired?: boolean; subdomain?: unknown } | null | undefined;
    const cursor = row?.cursor as { backfillCompletedAt?: string } | null | undefined;
    const adapter = PROVIDERS[provider];
    const { access } = WEB_PROVIDERS[provider];
    return {
      provider,
      label: INTEGRATION_PROVIDER_LABELS[provider],
      role: adapter.role,
      capabilities: adapter.capabilities,
      access: { scopes: access.scopes, note: access.note ?? null },
      // A disconnect is a soft transition that keeps the row; it is not connected.
      connected: row !== undefined && row.status !== "disconnected",
      backfillComplete: cursor?.backfillCompletedAt != null,
      reauthRequired: row?.status === "reauth_required" || credentials?.reauthRequired === true,
      subdomain: typeof credentials?.subdomain === "string" ? credentials.subdomain : null,
      config: configs[index]!,
    };
  });

  return { providers, ticketsFetched, escalatedCases, linkedIssues };
}

/** Raw case snapshots stored so far, across the ticket sources: each adapter names the prefix of its own. */
async function countSnapshots(prisma: PrismaClient, organizationId: string): Promise<number> {
  const counts = await Promise.all(
    TICKET_SOURCE_PROVIDERS.flatMap((provider) => {
      const prefix = WEB_PROVIDERS[provider].snapshotEventPrefix;
      return prefix === undefined
        ? []
        : [
            prisma.rawEvent.count({
              where: { integration: { organizationId, provider, ...RAW_EVENT_SOURCE_CONNECTED.integration }, providerEventId: { startsWith: prefix } },
            }),
          ];
    }),
  );
  return counts.reduce((sum, n) => sum + n, 0);
}
