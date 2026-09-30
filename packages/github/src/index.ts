export { mapPullRequestToRawEvent, mapTimelineItemToRawEvent } from "./rawEvents";
export type { RawEventInput } from "./rawEvents";
export * from "./types";
export { GithubClient, GithubApiError, GithubPermissionDeniedError } from "./client";
export type { GithubClientOptions } from "./client";
export { computeSourceHash } from "./hash";
export { runGithubBackfill } from "./backfill";
export type { BackfillResult } from "./backfill";
export type { GithubOAuthConfig } from "./oauth";
export { buildAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, GithubOAuthError } from "./oauth";
export { loadFreshGithubCredentials, refreshAfterUnauthorized, GithubReauthRequiredError } from "./tokenLifecycle";
export {
  normalizeGithubTimelineItemType,
  resolveGithubActor,
  sortTimelineChronologically,
  deriveNormalizedEventsForPullRequest,
  runGithubNormalization,
  UnknownGithubTimelineItemTypeError,
} from "./normalize";
export type { TimelineRecord, DerivedNormalizedEvent, GithubNormalizationResult } from "./normalize";
export { extractIssueIdentifiers, runGithubCorrelation } from "./correlate";
export type { CorrelationResult } from "./correlate";
export { GITHUB_SOURCE_ROLE } from "./source-role";
