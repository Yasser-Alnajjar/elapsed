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
  runJiraNormalization,
  UnknownJiraStatusCategoryError,
  UnknownJiraStatusError,
} from "./normalize";
export type {
  ChangelogRecord,
  DerivedNormalizedEvent,
  JiraNormalizationResult,
  JiraNormalizationScope,
} from "./normalize";
export { runJiraCorrelation } from "./correlate";
export type { CaseRefResolution, CaseRefResolver, CorrelationResult, JiraCorrelationScope } from "./correlate";
export {
  extractJiraWebhookIssueKey,
  generateWebhookSecret,
  isJiraIssueDeletedEvent,
  isJiraWebhookTimestampFresh,
  markCaseLinksUnlinkedForIssue,
  runJiraWebhookIngest,
  shouldIngestJiraWebhookEvent,
  verifyJiraWebhookSecret,
  verifyJiraWebhookSignature,
} from "./webhook";
export type { JiraWebhookPayload, WebhookIngestResult } from "./webhook";
export { JIRA_SOURCE_ROLE } from "./source-role";
