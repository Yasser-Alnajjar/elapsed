export {
  mapChangelogHistoryToRawEvent,
  mapIssueDeletedToRawEvent,
  mapIssueToRawEvent,
  mapRemoteLinkManifestToRawEvent,
  mapRemoteLinkToRawEvent,
  mapStatusToRawEvent,
} from "./rawEvents";
export type { RawEventInput } from "./rawEvents";
export * from "./types";
export { JiraClient, JiraApiError, JiraPermissionDeniedError } from "./client";
export type { JiraClientOptions } from "./client";
export { computeSourceHash } from "./hash";
export { runJiraBackfill, formatJqlDateTime } from "./backfill";
export type { BackfillResult } from "./backfill";
export type { JiraOAuthConfig } from "./oauth";
export {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  JIRA_OAUTH_SCOPES,
  JiraOAuthError,
} from "./oauth";
export {
  loadFreshJiraCredentials,
  refreshAfterUnauthorized,
  JiraReauthRequiredError,
} from "./tokenLifecycle";
export {
  normalizeJiraStatusCategory,
  buildStatusLookup,
  resolveJiraActor,
  sortHistoriesChronologically,
  deriveNormalizedEventsForIssue,
  buildJiraBatch,
  UnknownJiraStatusCategoryError,
  UnknownJiraStatusError,
} from "./normalize";
export type {
  ChangelogRecord,
  DerivedNormalizedEvent,
  JiraNormalizationScope,
} from "./normalize";
export { correlateJira } from "./correlate";
export type { JiraCorrelationScope } from "./correlate";
export { jiraAdapter, jiraWebAdapter } from "./adapter";
export {
  extractJiraWebhookIssueKey,
  generateWebhookSecret,
  isJiraIssueDeletedEvent,
  isJiraWebhookTimestampFresh,
  recordJiraIssueDeletion,
  runJiraWebhookIngest,
  shouldIngestJiraWebhookEvent,
  verifyJiraWebhookSecret,
  verifyJiraWebhookSignature,
} from "./webhook";
export type { JiraWebhookPayload, WebhookIngestResult } from "./webhook";
export { JIRA_SOURCE_ROLE } from "./source-role";
