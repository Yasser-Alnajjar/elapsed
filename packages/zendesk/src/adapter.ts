import { IntegrationNotConfiguredError, type ProviderAdapter, type ProviderWebAdapter } from "@sla/ingestion";
import { runZendeskBackfill } from "./backfill";
import { runZendeskBusinessCalendarImport } from "./calendars";
import { renderZendeskConversation, zendeskConversationContext } from "./conversation";
import { correlateZendeskJiraLinks } from "./correlate";
import { buildZendeskBatch } from "./normalize";
import { ZENDESK_OAUTH_SCOPES } from "./oauth";
import { runZendeskSlaPolicyImport } from "./policies";
import { ZENDESK_SOURCE_ROLE } from "./source-role";
import { recognizeZendeskTicketUrl } from "./ticket-url";
import type { ZendeskCredentials } from "./types";
import { verifyZendeskWebhookSecret } from "./webhook";

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

/**
 * Zendesk: the full-featured ticket source. Receives webhooks, imports SLA
 * policies and business-hours calendars, re-derives only changed tickets on the
 * active-set poll (a watermark on the `Integration`), and reports the official
 * Zendesk↔Jira links as case links of its own.
 */
export const zendeskAdapter: ProviderAdapter = {
  provider: "zendesk",
  role: ZENDESK_SOURCE_ROLE,
  capabilities: {
    webhooks: true,
    policyImport: true,
    calendarImport: true,
    incrementalNormalization: true,
    replyEvents: true,
    priorityChanges: true,
    officialLinks: true,
  },
  async ingest(ctx) {
    if (!ctx.appUrl) throw new Error("Worker app URL is not configured (NEXTAUTH_URL)");
    const config = await ctx.loadOAuthConfig();
    if (!config) throw new IntegrationNotConfiguredError("Zendesk");
    const counts = {
      ...(await runZendeskBackfill(
        ctx.prisma,
        ctx.integration.id,
        { ...config, redirectUri: `${ctx.appUrl}/api/integrations/zendesk/callback` },
        { logger: ctx.logger, sinceDays: ctx.sinceDays },
      )),
    };
    return { recordsFetched: total(counts), counts };
  },
  // The poll only re-derives tickets touched since the watermark; the
  // reconciliation sweep re-derives them all (and is the backstop for anything
  // the watermark could miss). A webhook narrows to its own tickets.
  normalize: (ctx) =>
    buildZendeskBatch(ctx.prisma, ctx.integration.id, {
      mode: ctx.mode,
      ticketIds: ctx.externalIds?.map(Number).filter(Number.isFinite),
    }),
  correlate: (ctx) => correlateZendeskJiraLinks(ctx.prisma, ctx.integration.id),
  recognizeCaseUrl: recognizeZendeskTicketUrl,
  importCalendars: (ctx) => runZendeskBusinessCalendarImport(ctx.prisma, ctx.integration.id),
  importPolicies: (ctx) => runZendeskSlaPolicyImport(ctx.prisma, ctx.integration.id, ctx.ensureDefaultCalendarVersion),
};

export const zendeskWebAdapter: ProviderWebAdapter = {
  access: { scopes: ZENDESK_OAUTH_SCOPES },
  snapshotEventPrefix: "ticket:",
  externalUrl({ externalId, credentials }) {
    const subdomain = (credentials as Partial<ZendeskCredentials> | null | undefined)?.subdomain;
    return typeof subdomain === "string" && subdomain !== "" ? `https://${subdomain}.zendesk.com/agent/tickets/${externalId}` : null;
  },
  conversationContext: zendeskConversationContext,
  renderConversation: renderZendeskConversation,
  // Zendesk's own signing secret can't be chosen by us, so customers paste the
  // integration's secret as a Bearer token.
  async verifyWebhook(req, secret) {
    return verifyZendeskWebhookSecret(secret, req.headers.get("authorization"));
  },
};
