import type { ProviderAdapter, ProviderWebAdapter } from "@sla/ingestion";
import { CUSTOM_PROVIDER, CUSTOM_SOURCE_ROLE } from "./derive";
import { runCustomIngest } from "./ingest";
import { normalizeCustom } from "./normalize";
import { customTicketUrl, recognizeCustomTicketUrl } from "./ticket-url";
import { RAW_PREFIX } from "./shared";

/**
 * The `custom` ticket source (D31, N9): one statically registered adapter that
 * interprets a validated, versioned configuration. It never executes
 * customer-supplied code. No webhooks, policy or calendar import, priority
 * change events or official links; `incrementalNormalization` stays false
 * until the plan 09 benchmark evidence exists (6.9, 6.10). `replyEvents` is
 * true because Full SLA derives them; what a given integration cannot support
 * is recorded per integration in `Integration.slaSupport`.
 */
export const customAdapter: ProviderAdapter = {
  provider: CUSTOM_PROVIDER,
  role: CUSTOM_SOURCE_ROLE,
  capabilities: {
    webhooks: false,
    policyImport: false,
    calendarImport: false,
    incrementalNormalization: false,
    replyEvents: true,
    priorityChanges: false,
    officialLinks: false,
  },
  ingest: runCustomIngest,
  normalize: normalizeCustom,
  recognizeCaseUrl: recognizeCustomTicketUrl,
};

export const CUSTOM_ACCESS_NOTE =
  "Read-only is enforced by the request rules, not by OAuth scopes: Elapsed sends only GET requests, plus POST to endpoints you designate as read-only searches, over HTTPS, and never creates, edits or deletes anything in your ticket system.";

export const customWebAdapter: ProviderWebAdapter = {
  access: { scopes: [], note: CUSTOM_ACCESS_NOTE },
  snapshotEventPrefix: RAW_PREFIX.ticket,
  externalUrl: ({ externalId, credentials }) => customTicketUrl(externalId, credentials),
};
