export { mapAttachmentToRawEvent, mapHistoryEntryToRawEvent, mapIssueToRawEvent } from "./rawEvents";
export type { RawEventInput } from "./rawEvents";
export * from "./types";
export { LinearClient, LinearApiError, LinearPermissionDeniedError } from "./client";
export type { LinearClientOptions } from "./client";
export { computeSourceHash } from "./hash";
export { runLinearBackfill } from "./backfill";
export type { BackfillResult } from "./backfill";
export type { LinearOAuthConfig } from "./oauth";
export { buildAuthorizeUrl, exchangeCodeForToken, LINEAR_OAUTH_SCOPES, LinearOAuthError } from "./oauth";
export { loadFreshLinearCredentials, markReauthRequired, LinearReauthRequiredError } from "./tokenLifecycle";
export {
  normalizeLinearStateType,
  resolveLinearActor,
  sortHistoriesChronologically,
  deriveNormalizedEventsForIssue,
  buildLinearBatch,
  UnknownLinearStateTypeError,
} from "./normalize";
export type { HistoryRecord, DerivedNormalizedEvent } from "./normalize";
export { correlateLinear } from "./correlate";
export { linearAdapter, linearWebAdapter } from "./adapter";
export { LINEAR_SOURCE_ROLE } from "./source-role";
