import { IntegrationNotConfiguredError, type ProviderAdapter, type ProviderWebAdapter } from "@sla/ingestion";
import { runGithubBackfill } from "./backfill";
import { correlateGithub } from "./correlate";
import { buildGithubBatch } from "./normalize";
import { GITHUB_SOURCE_ROLE } from "./source-role";

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

/**
 * GitHub: a code host linked onto cases transitively — a pull request whose
 * title or branch names an issue that Jira or Linear already linked. Unlike
 * Linear, its backfill needs the App's client id and secret: GitHub App user
 * tokens expire and are refreshed like Jira's.
 */
export const githubAdapter: ProviderAdapter = {
  provider: "github",
  role: GITHUB_SOURCE_ROLE,
  capabilities: {
    webhooks: false,
    policyImport: false,
    calendarImport: false,
    incrementalNormalization: false,
    replyEvents: false,
    priorityChanges: false,
    officialLinks: false,
  },
  async ingest(ctx) {
    const config = await ctx.loadOAuthConfig();
    if (!config) throw new IntegrationNotConfiguredError("GitHub");
    const counts = { ...(await runGithubBackfill(ctx.prisma, ctx.integration.id, config, { sinceDays: ctx.sinceDays })) };
    return { recordsFetched: total(counts), counts };
  },
  normalize: (ctx) => buildGithubBatch(ctx.prisma, ctx.integration.id),
  correlate: (ctx) => correlateGithub(ctx.prisma, ctx.integration.id),
};

export const githubWebAdapter: ProviderWebAdapter = {
  // A pull request's externalId (`owner/repo#number`) is enough to build its
  // URL: no credential lookup or evidence capture needed.
  externalUrl: ({ externalId }) => `https://github.com/${externalId.replace("#", "/pull/")}`,
};
