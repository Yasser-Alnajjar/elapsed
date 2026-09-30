import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { withPerfMetrics } from "./perf-metrics";
export * from "../generated/prisma/client";
export { findCustomerByIdentity, upsertCustomerByIdentity } from "./customer-identity";
export type { CustomerIdentityRef } from "./customer-identity";
export { deriveEncryptionKey, aesGcmEncrypt, aesGcmDecrypt } from "./crypto";
export {
  isConfigurableIntegrationProvider,
  getIntegrationConfig,
  getIntegrationConfigStatus,
  saveIntegrationConfig,
  encryptSecret,
  decryptSecret,
  IntegrationConfigUnreadableError,
} from "./integration-config";
export type {
  ConfigurableIntegrationProvider,
  IntegrationOAuthCredentials,
  IntegrationConfigStatus,
} from "./integration-config";
export {
  isEncryptedToken,
  encryptToken,
  decryptToken,
  encryptCredentials,
  decryptCredentials,
  IntegrationCredentialsUnreadableError,
} from "./integration-credentials";
export {
  getEmailSettings,
  getEmailSettingsStatus,
  saveEmailSettings,
  savedPasswordApplies,
  SmtpPasswordRequiredError,
  encryptSmtpPassword,
  decryptSmtpPassword,
  EmailSettingsUnreadableError,
} from "./email-settings";
export type {
  EmailSecurity,
  EmailSettingsInput,
  EmailSettingsCredentials,
  EmailSettingsStatus,
} from "./email-settings";
export {
  MIN_ACTIVE_POLL_INTERVAL_MS,
  MAX_ACTIVE_POLL_INTERVAL_MS,
  MIN_RECONCILIATION_INTERVAL_MS,
  MAX_RECONCILIATION_INTERVAL_MS,
  ACTIVE_POLL_SAFETY_DIVISOR,
  getOrCreateWorkerSettings,
  getWorkerSettingsForRead,
  getMinimumConfiguredSlaTargetMinutes,
  validateWorkerSettingsInput,
  saveWorkerSettings,
  recordWorkerCycleOutcome,
  recordWorkerNextRun,
  deriveWorkerStatus,
  WorkerSettingsValidationError,
} from "./worker-settings";
export type {
  WorkerSettingsInput,
  WorkerSettingsRecord,
  WorkerStatus,
} from "./worker-settings";

export {
  WORKER_ADVISORY_LOCK_KEY,
  connectAdvisoryLockConnection,
} from "./advisory-lock";
export type { AdvisoryLockConnection } from "./advisory-lock";
export { withOrganizationSlaLock } from "./organization-lock";
export {
  LIVE_DATA_CHANNEL,
  publishLiveDataEvent,
  subscribeToLiveData,
} from "./live-events";
export type {
  LiveDataEvent,
  LiveDataSubscription,
  LiveListenerConnectionState,
  LiveListenerStatus,
} from "./live-events";
export { recordSlaImportSummary } from "./sla-import-summary";
export type { SlaImportSummaryInput } from "./sla-import-summary";
export { isPerfMetricsEnabled, perfCount, withPerfScope } from "./perf-metrics";

export { generateSecureToken, hashToken } from "./secure-token";
export {
  INVITATION_TTL_MS,
  normalizeEmail,
  createOrResendInvitation,
  listPendingInvitations,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  EmailAlreadyRegisteredError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationNotPendingError,
  InvitationConflictError,
} from "./invitations";
export type {
  CreateOrResendInvitationResult,
  InvitationPreview,
  AcceptInvitationInput,
  AcceptInvitationResult,
} from "./invitations";

export {
  listMembers,
  updateMemberRole,
  removeMember,
  MemberNotFoundError,
  CannotRemoveSelfError,
  LastOwnerError,
} from "./members";
export type { OrganizationMember } from "./members";

export {
  PASSWORD_RESET_TTL_MS,
  requestPasswordReset,
  resetPassword,
  PasswordResetTokenNotFoundError,
  PasswordResetTokenExpiredError,
  PasswordResetTokenUsedError,
} from "./password-reset";
export type {
  RequestPasswordResetResult,
  ResetPasswordResult,
} from "./password-reset";

export {
  EMAIL_VERIFICATION_TTL_MS,
  createEmailVerificationToken,
  createEmailChangeToken,
  verifyEmail,
  EmailVerificationTokenNotFoundError,
  EmailVerificationTokenExpiredError,
  EmailVerificationTokenUsedError,
} from "./email-verification";
export type { IssueTokenResult, VerifyEmailResult } from "./email-verification";

const DEFAULT_POOL_MAX = 20;
const STATEMENT_TIMEOUT_MS = 30_000;

function readPoolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX;
  if (!raw) return DEFAULT_POOL_MAX;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POOL_MAX;
}

// Stashed on `globalThis` rather than a plain module-level variable: in
// `next dev`, Next.js's module system re-evaluates this module on every hot
// reload (a fresh module instance, but the same process/`globalThis`), so a
// plain `let` would open a new pool — and exhaust `DATABASE_POOL_MAX`
// connections — on every edit instead of reusing one across reloads.
// apps/worker doesn't hot-reload, but sharing the same singleton mechanism
// there is harmless (still exactly one pool per process).
const globalForPrisma = globalThis as unknown as { __slaPrisma?: PrismaClient };

/** Lazily-created singleton so apps/web and apps/worker share one connection pool per process. */
export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.__slaPrisma) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
      // Bounded so a request pile-up (Phase 1's runaway per-page query
      // counts, pre-fix) exhausts a known pool size and queues instead of
      // opening an unbounded number of Postgres connections.
      // `statement_timeout` fails a runaway query loudly rather than
      // pinning a pool connection forever.
      max: readPoolMax(),
      statement_timeout: STATEMENT_TIMEOUT_MS,
    });
    globalForPrisma.__slaPrisma = withPerfMetrics(
      new PrismaClient({ adapter }),
    ) as PrismaClient;
  }
  return globalForPrisma.__slaPrisma;
}
