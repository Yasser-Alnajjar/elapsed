import { IntegrationNotConfiguredError, type ProviderAdapter, type ProviderWebAdapter } from "@sla/ingestion";
import { runJiraBackfill } from "./backfill";
import { correlateJira } from "./correlate";
import { buildJiraBatch } from "./normalize";
import { JIRA_SOURCE_ROLE } from "./source-role";
import { verifyJiraWebhookSecret, verifyJiraWebhookSignature } from "./webhook";
import type { JiraCredentials } from "./types";

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

/** Jira: a work tracker linked onto cases by remote links whose URL a ticket source recognizes; receives classic admin webhooks. */
export const jiraAdapter: ProviderAdapter = {
  provider: "jira",
  role: JIRA_SOURCE_ROLE,
  capabilities: {
    webhooks: true,
    policyImport: false,
    calendarImport: false,
    incrementalNormalization: false,
    replyEvents: false,
    priorityChanges: false,
    officialLinks: false,
  },
  async ingest(ctx) {
    if (!ctx.appUrl) throw new Error("Worker app URL is not configured (NEXTAUTH_URL)");
    const config = await ctx.loadOAuthConfig();
    if (!config) throw new IntegrationNotConfiguredError("Jira");
    const counts = {
      ...(await runJiraBackfill(
        ctx.prisma,
        ctx.integration.id,
        { ...config, redirectUri: `${ctx.appUrl}/api/integrations/jira/callback` },
        { sinceDays: ctx.sinceDays },
      )),
    };
    return { recordsFetched: total(counts), counts };
  },
  normalize: (ctx) => buildJiraBatch(ctx.prisma, ctx.integration.id, { issueKeys: ctx.externalIds }),
  correlate: (ctx) =>
    correlateJira(ctx.prisma, ctx.integration.id, ctx.resolveCaseRef, {
      issueKey: ctx.externalIds?.length === 1 ? ctx.externalIds[0] : undefined,
    }),
};

export const jiraWebAdapter: ProviderWebAdapter = {
  externalUrl({ externalId, credentials }) {
    const siteUrl = (credentials as Partial<JiraCredentials> | null | undefined)?.siteUrl;
    return typeof siteUrl === "string" ? `${siteUrl.replace(/\/$/, "")}/browse/${externalId}` : null;
  },
  /**
   * A signed delivery (`X-Hub-Signature`) must verify on its own; a bad
   * signature never falls through to the legacy `?secret=` check, which only
   * applies to webhooks set up before signing existed.
   */
  async verifyWebhook(req, secret) {
    const signature = req.headers.get("x-hub-signature");
    if (signature !== null) return verifyJiraWebhookSignature(secret, await req.clone().text(), signature);
    return verifyJiraWebhookSecret(secret, new URL(req.url).searchParams.get("secret"));
  },
};
