import type {
  ConfigurableIntegrationProvider,
  IntegrationConfigStatus,
  IntegrationDataCounts,
} from "@sla/db";
import type { SourceRole } from "@sla/core";
import type { SlackChannel } from "@sla/slack";
import type { BackfillResult as GithubBackfillResult } from "@sla/github";
import type { BackfillResult as IntercomBackfillResult } from "@sla/intercom";
import type { BackfillResult as JiraBackfillResult } from "@sla/jira";
import type { BackfillResult as LinearBackfillResult } from "@sla/linear";
import type { ProjectionResult } from "@sla/ingestion";
import type { BackfillResult as ZendeskBackfillResult } from "@sla/zendesk";

/**
 * Narrow, display-only view of one Zendesk/Jira/Linear `Integration` row for
 * a client component — never the row itself. `connected` means "has live
 * credentials" (true for `connected` and `reauth_required` status, false for
 * `disconnected` or no row); `connectedAt`/`disconnectedAt` stay populated
 * across a disconnect so the UI can still show "Disconnected {date}."
 * `permissionDenied` (roadmap step 32) means the token works but the
 * connecting user lost access provider-side — also `connected: true`.
 */
export interface IntegrationConnectionView {
  /** The provider adapter's role (`PROVIDERS[provider].role`) — what the integrations page groups cards by. */
  role: SourceRole;
  connected: boolean;
  reauthRequired: boolean;
  permissionDenied: boolean;
  /** A platform operator paused polling for this integration (N4.5): no new data arrives until they resume it. */
  pollingPaused: boolean;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  subdomain: string | null;
}

/** Narrow, display-only view of `SlackIntegration` — never the row itself (it carries a bot access token). */
export interface SlackConnectionView {
  connected: boolean;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  installedAt: Date | null;
}

export interface IntegrationsPageData {
  zendesk: IntegrationConnectionView;
  jira: IntegrationConnectionView;
  linear: IntegrationConnectionView;
  linearConfig: IntegrationConfigStatus;
  intercom: IntegrationConnectionView;
  intercomConfig: IntegrationConfigStatus;
  github: IntegrationConnectionView;
  githubConfig: IntegrationConfigStatus;
  slack: SlackConnectionView;
  zendeskConfig: IntegrationConfigStatus;
  jiraConfig: IntegrationConfigStatus;
  slackConfig: IntegrationConfigStatus;
}

export type { ConfigurableIntegrationProvider, IntegrationConfigStatus };

export interface ZendeskSyncResult {
  backfill: ZendeskBackfillResult;
  normalization: ProjectionResult;
}

export type {
  SlackChannel,
  GithubBackfillResult,
  IntercomBackfillResult,
  JiraBackfillResult,
  LinearBackfillResult,
};

export type IntegrationProvider =
  | "zendesk"
  | "jira"
  | "linear"
  | "intercom"
  | "github";

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  "zendesk",
  "jira",
  "linear",
  "intercom",
  "github",
];

export function isIntegrationProvider(
  value: string,
): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as string[]).includes(value);
}

export const INTEGRATION_PROVIDER_LABELS: Record<IntegrationProvider, string> =
  {
    zendesk: "Zendesk",
    jira: "Jira",
    linear: "Linear",
    intercom: "Intercom",
    github: "GitHub",
  };

/**
 * Read model for `/settings/integrations/[provider]` (roadmap step 20
 * follow-up): everything beyond connect/disconnect for one integration that
 * exists — backfill and, for a provider with the `webhooks` capability, the
 * real-time webhook setup. A disconnected integration has a read model too:
 * disconnect keeps the row and its data, so the page stays reachable (to see
 * what was imported, and to clean it up).
 * Display-only scalars derived server-side from the `Integration` row and its
 * JSON `credentials`/`cursor` — neither ever reaches the client directly.
 * `webhookSecret` is the one exception to "no secrets to the client": it's
 * intentionally user-visible, see `WebhookInfo`.
 */
export interface IntegrationDetailData {
  provider: IntegrationProvider;
  integrationId: string;
  connectedAt: Date;
  /** Disconnected: credentials cleared and sync stopped, but the row and its imported data remain. */
  disconnected: boolean;
  disconnectedAt: Date | null;
  /** What this integration has imported and still holds — what "Clean up data" would remove. */
  importedData: IntegrationDataCounts;
  reauthRequired: boolean;
  /** The token works, but the connecting user lost provider-side access (roadmap step 32). */
  permissionDenied: boolean;
  /** A platform operator paused polling for this integration (N4.5). */
  pollingPaused: boolean;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  lastSuccessfulSyncAt: Date | null;
  consecutiveFailures: number;
  failingSince: Date | null;
  lastSyncDurationMs: number | null;
  /** ISO 8601, matching the provider cursor's own `backfillCompletedAt`. */
  backfillCompletedAt: Date | null;
  webhookSecret: string | null;
  /** The provider receives webhooks (its adapter's `webhooks` capability). */
  webhooks: boolean;
  /** Zendesk only. */
  subdomain?: string;
  /** GitHub only — the single `owner/repo` this integration is scoped to. */
  repo?: string;
}
