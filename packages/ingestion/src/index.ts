export {
  IntegrationNotConfiguredError,
  PERMISSION_DENIED_BRAND,
  PermissionDeniedError,
  ProviderUnavailableError,
  ReauthRequiredError,
} from "./errors";
export type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderAccess,
  ProviderWebAdapter,
  IntegrationRef,
  IngestContext,
  IngestResult,
  NormalizeContext,
  CorrelateContext,
  ImportContext,
  PolicyImportResult,
  CalendarImportResult,
  CanonicalBatch,
  CaseFacts,
  CustomerIdentityFact,
  CustomerIdentityRef,
  EventGroup,
  ProjectionFailure,
  NormalizedEventFact,
  CorrelationOutput,
  LinkFact,
  LinkEventSource,
  LinkSweep,
  LinkManifest,
  CaseRefResolution,
  CaseRefResolver,
  ConversationEventRef,
  ConversationInput,
  ConversationMessage,
} from "./contract";
export { projectCanonicalBatch } from "./projector";
export type { ProjectionResult } from "./projector";
export { diffNormalizedEvents, normalizedEventKey } from "./diff";
export { projectIssueRemoval, projectLinkFacts, projectLinkSweep } from "./link-projector";
export type { IssueRemoval, LinkProjectionResult, LinkSweepResult } from "./link-projector";
export { correlateAndProject, normalizeAndProject, syncIntegration, ticketUrlRecognizers } from "./pipeline";
export type { CorrelationProjection, IntegrationSyncInput, IntegrationSyncResult } from "./pipeline";
