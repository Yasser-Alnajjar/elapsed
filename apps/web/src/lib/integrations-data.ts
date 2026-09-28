import { cache } from "react";
import type { PrismaClient } from "@sla/db";
import { getIntegrationConfigStatus } from "@sla/db";
import type { ZendeskCredentials } from "@sla/zendesk";
import type {
  IntegrationConnectionView,
  IntegrationsPageData,
} from "./types/integrations";

type IntegrationRow = {
  connectedAt: Date;
  disconnectedAt: Date | null;
  credentials: unknown;
  status: string;
} | null;

const ROW_SELECT = {
  connectedAt: true,
  disconnectedAt: true,
  credentials: true,
  status: true,
} as const;

/** Never return `credentials`/the row itself — only these display-only scalars. */
function toConnectionView(
  integration: IntegrationRow,
  subdomain: string | null = null,
): IntegrationConnectionView {
  if (!integration) {
    return {
      connected: false,
      reauthRequired: false,
      permissionDenied: false,
      connectedAt: null,
      disconnectedAt: null,
      subdomain: null,
    };
  }

  const credentials = integration.credentials as {
    reauthRequired?: boolean;
  } | null;

  return {
    connected: credentials !== null,
    reauthRequired: credentials?.reauthRequired === true,
    permissionDenied: integration.status === "permission_denied",
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
  return {
    zendesk: {
      ...toConnectionView(zendeskIntegration),
      subdomain: zendeskCredentials?.subdomain ?? null,
    },
    jira: {
      ...toConnectionView(jiraIntegration),
      subdomain: jiraSubdomain ?? null,
    },
    linear: toConnectionView(linearIntegration),
    intercom: toConnectionView(intercomIntegration),
    github: toConnectionView(githubIntegration),
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
