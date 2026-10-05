export {
  buildIntercomBatch,
  deriveNormalizedEventsForConversation,
  deriveCaseClosedAt,
  deriveIntercomSubject,
  extractIntercomMessageBody,
  isVisibleMessagePart,
  normalizeIntercomPriority,
  normalizeIntercomState,
  resolveIntercomActor,
  sortPartsChronologically,
  UnknownIntercomStateError,
} from "./normalize";
export type {
  ConversationPartRecord,
  DerivedNormalizedEvent,
  IntercomMessageBody,
} from "./normalize";
export {
  mapAdminToRawEvent,
  mapCompanyToRawEvent,
  mapContactToRawEvent,
  mapConversationPartToRawEvent,
  mapConversationToRawEvent,
} from "./rawEvents";
export type { RawEventInput } from "./rawEvents";
export * from "./types";
export {
  buildIntercomConversationUrl,
  IntercomClient,
  IntercomApiError,
  IntercomPermissionDeniedError,
} from "./client";
export type { IntercomClientOptions } from "./client";
export { computeSourceHash } from "./hash";
export { recognizeIntercomConversationUrl } from "./ticket-url";
export { runIntercomBackfill } from "./backfill";
export type { BackfillResult } from "./backfill";
export type { IntercomOAuthConfig } from "./oauth";
export { buildAuthorizeUrl, exchangeCodeForToken, INTERCOM_ACCESS_NOTE, IntercomOAuthError } from "./oauth";
export {
  loadFreshIntercomCredentials,
  markReauthRequired,
  recordIntercomWorkspaceId,
  IntercomReauthRequiredError,
} from "./tokenLifecycle";
export { INTERCOM_JIRA_LINK_EVENT_SOURCE_ROLE, INTERCOM_SOURCE_ROLE } from "./source-role";
export { INTERCOM_TRACKER_CATEGORY, INTERCOM_TRACKER_TICKET_CATEGORY, isIntercomTrackerTicket, linkedTrackerIds } from "./tracker";
export { correlateIntercomJiraKeys, INTERCOM_JIRA_EVIDENCE_KEY, INTERCOM_JIRA_KEY_ATTRIBUTE } from "./correlate";
export { intercomAdapter, intercomWebAdapter } from "./adapter";
export { renderIntercomConversation } from "./conversation";
