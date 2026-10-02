import type { ProviderAdapter, ProviderWebAdapter } from "@sla/ingestion";
import { runIntercomBackfill } from "./backfill";
import { buildIntercomConversationUrl } from "./client";
import { renderIntercomConversation } from "./conversation";
import { buildIntercomBatch } from "./normalize";
import { INTERCOM_ACCESS_NOTE } from "./oauth";
import { INTERCOM_SOURCE_ROLE } from "./source-role";
import { recognizeIntercomConversationUrl } from "./ticket-url";

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

/**
 * Intercom: a ticket source with no importable policies and no webhook. Its
 * backfill needs no OAuth client config (the tokens carry no refresh dance);
 * only the connect/callback routes need the app's client id and secret.
 */
export const intercomAdapter: ProviderAdapter = {
  provider: "intercom",
  role: INTERCOM_SOURCE_ROLE,
  capabilities: {
    webhooks: false,
    policyImport: false,
    calendarImport: false,
    incrementalNormalization: false,
    replyEvents: true,
    priorityChanges: false,
    officialLinks: false,
  },
  async ingest(ctx) {
    const counts = { ...(await runIntercomBackfill(ctx.prisma, ctx.integration.id, { sinceDays: ctx.sinceDays })) };
    return { recordsFetched: total(counts), counts };
  },
  normalize: (ctx) => buildIntercomBatch(ctx.prisma, ctx.integration.id),
  recognizeCaseUrl: recognizeIntercomConversationUrl,
};

export const intercomWebAdapter: ProviderWebAdapter = {
  access: { scopes: [], note: INTERCOM_ACCESS_NOTE },
  snapshotEventPrefix: "conversation:",
  // The inbox link needs the workspace id the backfill records from `GET /me`:
  // null until the first sync after connecting.
  externalUrl({ externalId, credentials }) {
    const workspaceId = (credentials as { workspaceId?: unknown } | null | undefined)?.workspaceId;
    return typeof workspaceId === "string" && workspaceId !== "" ? buildIntercomConversationUrl(workspaceId, externalId) : null;
  },
  renderConversation: renderIntercomConversation,
};
