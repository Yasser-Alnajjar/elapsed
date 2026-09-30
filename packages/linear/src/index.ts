export { mapAttachmentToRawEvent, mapHistoryEntryToRawEvent, mapIssueToRawEvent } from "./rawEvents";
export type { RawEventInput } from "./rawEvents";
export * from "./types";
export { LinearClient, LinearApiError, LinearPermissionDeniedError } from "./client";
export type { LinearClientOptions } from "./client";
export { computeSourceHash } from "./hash";
export { runLinearBackfill } from "./backfill";
export type { BackfillResult } from "./backfill";
export type { LinearOAuthConfig } from "./oauth";
export { buildAuthorizeUrl, exchangeCodeForToken, LinearOAuthError } from "./oauth";
export { loadFreshLinearCredentials, markReauthRequired, LinearReauthRequiredError } from "./tokenLifecycle";
export {
  normalizeLinearStateType,
  resolveLinearActor,
  sortHistoriesChronologically,
  deriveNormalizedEventsForIssue,
  runLinearNormalization,
  UnknownLinearStateTypeError,
} from "./normalize";
export type { HistoryRecord, DerivedNormalizedEvent, LinearNormalizationResult } from "./normalize";
export { runLinearCorrelation } from "./correlate";
export type { CaseRefResolution, CaseRefResolver, CorrelationResult } from "./correlate";
export { LINEAR_SOURCE_ROLE } from "./source-role";
