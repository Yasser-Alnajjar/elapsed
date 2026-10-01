import type { ProviderAdapter, ProviderWebAdapter } from "@sla/ingestion";
import { runLinearBackfill } from "./backfill";
import { correlateLinear } from "./correlate";
import { buildLinearBatch } from "./normalize";
import { LINEAR_SOURCE_ROLE } from "./source-role";

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

/**
 * Linear: a work tracker linked onto cases by attachments whose URL a ticket
 * source recognizes. Its backfill needs no OAuth client config (the tokens
 * carry no refresh dance).
 */
export const linearAdapter: ProviderAdapter = {
  provider: "linear",
  role: LINEAR_SOURCE_ROLE,
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
    const counts = { ...(await runLinearBackfill(ctx.prisma, ctx.integration.id, { sinceDays: ctx.sinceDays })) };
    return { recordsFetched: total(counts), counts };
  },
  normalize: (ctx) => buildLinearBatch(ctx.prisma, ctx.integration.id),
  correlate: (ctx) => correlateLinear(ctx.prisma, ctx.integration.id, ctx.resolveCaseRef),
};

export const linearWebAdapter: ProviderWebAdapter = {
  // Linear's stored OAuth credentials carry no workspace URL to rebuild a
  // browse link from, so the correlator captured the issue's own `url` into
  // the link's evidence.
  externalUrl: ({ evidence }) => (evidence as { issueUrl?: string } | null | undefined)?.issueUrl ?? null,
};
