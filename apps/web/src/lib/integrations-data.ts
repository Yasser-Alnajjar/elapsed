import { cache } from "react";
import type { PrismaClient } from "@sla/db";
import { getIntegrationConfigStatus } from "@sla/db";
import type { ZendeskCredentials } from "@sla/zendesk";
import { getCustomStatus } from "./custom-provider/status";
import { providerRole } from "./providers";
import type {
  IntegrationConnectionView,
  IntegrationProvider,
  IntegrationsPageData,
} from "./types/integrations";

type IntegrationRow = {
  connectedAt: Date;
  disconnectedAt: Date | null;
  credentials: unknown;
  status: string;
  pollingPausedAt: Date | null;
} | null;

const ROW_SELECT = {
  connectedAt: true,
  disconnectedAt: true,
  credentials: true,
  status: true,
  pollingPausedAt: true,
} as const;

/** Never return `credentials`/the row itself — only these display-only scalars. */
function toConnectionView(
  provider: IntegrationProvider,
  integration: IntegrationRow,
  subdomain: string | null = null,
): IntegrationConnectionView {
  const role = providerRole(provider);

  if (!integration) {
    return {
      role,
      connected: false,
      reauthRequired: false,
      permissionDenied: false,
      pollingPaused: false,
      connectedAt: null,
      disconnectedAt: null,
      subdomain: null,
    };
  }

  const credentials = integration.credentials as {
    reauthRequired?: boolean;
  } | null;

  return {
    role,
    connected: credentials !== null,
    reauthRequired: credentials?.reauthRequired === true,
    permissionDenied: integration.status === "permission_denied",
    pollingPaused: integration.pollingPausedAt !== null,
    connectedAt: integration.connectedAt,
    disconnectedAt: integration.disconnectedAt,
    subdomain,
  };
}

/**
 * Assembles the integrations settings page's read model (roadmap step 17).
 * `React.cache`-wrapped: the layout and the Dashboard/Integrations pages
 * each call this within the same request, and its 12-query fan-out is
 * otherwise paid twice.
 */
export const getIntegrationsData = cache(async function getIntegrationsData(
  prisma: PrismaClient,
  organizationId: string,
): Promise<IntegrationsPageData> {
  const [
    zendeskIntegration,
    jiraIntegration,
    linearIntegration,
    intercomIntegration,
    githubIntegration,
    customIntegration,
    customFlag,
    slackIntegration,
    zendeskConfig,
    linearConfig,
    jiraConfig,
    slackConfig,
    intercomConfig,
    githubConfig,
  ] = await Promise.all([
    prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "zendesk" },
      },
      select: ROW_SELECT,
    }),
    prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "jira" } },
      select: ROW_SELECT,
    }),
    prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "linear" },
      },
      select: ROW_SELECT,
    }),
    prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "intercom" },
      },
      select: ROW_SELECT,
    }),
    prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: "github" },
      },
      select: ROW_SELECT,
    }),
    prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "custom" } },
      select: ROW_SELECT,
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { customProviderEnabled: true } }),
    prisma.slackIntegration.findUnique({
      where: { organizationId },
      select: {
        teamName: true,
        channelId: true,
        channelName: true,
        installedAt: true,
      },
    }),
    getIntegrationConfigStatus(prisma, organizationId, "zendesk"),
    getIntegrationConfigStatus(prisma, organizationId, "linear"),
    getIntegrationConfigStatus(prisma, organizationId, "jira"),
    getIntegrationConfigStatus(prisma, organizationId, "slack"),
    getIntegrationConfigStatus(prisma, organizationId, "intercom"),
    getIntegrationConfigStatus(prisma, organizationId, "github"),
  ]);

  const zendeskCredentials =
    (zendeskIntegration?.credentials as ZendeskCredentials | null) ?? null;

  const jiraCredentials =
    (jiraIntegration?.credentials as { siteUrl?: string } | null) ?? null;

  const jiraSubdomain = jiraCredentials?.siteUrl
    ? new URL(jiraCredentials.siteUrl).hostname.split(".")[0]
    : null;

  const intercomWorkspaceId =
    (intercomIntegration?.credentials as { workspaceId?: string } | null)
      ?.workspaceId ?? null;
  const githubCredentials =
    (githubIntegration?.credentials as {
      owner?: string;
      repo?: string;
    } | null) ?? null;
  const githubRepo =
    githubCredentials?.owner && githubCredentials.repo
      ? `${githubCredentials.owner}/${githubCredentials.repo}`
      : null;

  return {
    zendesk: {
      ...toConnectionView("zendesk", zendeskIntegration),
      subdomain: zendeskCredentials?.subdomain ?? null,
    },
    jira: {
      ...toConnectionView("jira", jiraIntegration),
      subdomain: jiraSubdomain ?? null,
    },
    linear: toConnectionView("linear", linearIntegration),
    intercom: toConnectionView("intercom", intercomIntegration, intercomWorkspaceId),
    github: toConnectionView("github", githubIntegration, githubRepo),
    custom: toConnectionView("custom", customIntegration),
    customEnabled: customFlag?.customProviderEnabled === true,
    customState: customIntegration && customIntegration.credentials !== null ? (await getCustomStatus(prisma, organizationId)).state : null,
    slack: {
      connected: slackIntegration !== null,
      teamName: slackIntegration?.teamName ?? null,
      channelId: slackIntegration?.channelId ?? null,
      channelName: slackIntegration?.channelName ?? null,
      installedAt: slackIntegration?.installedAt ?? null,
    },
    jiraConfig,
    zendeskConfig,
    linearConfig,
    slackConfig,
    intercomConfig,
    githubConfig,
  };
});
