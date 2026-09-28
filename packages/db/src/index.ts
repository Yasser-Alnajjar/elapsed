import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { withPerfMetrics } from "./perf-metrics";
export * from "../generated/prisma/client";
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

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

let prisma: PrismaClient | undefined;

/** Lazily-created singleton so apps/web and apps/worker share one connection pool per process. */
export function getPrismaClient(): PrismaClient {
  if (!prisma)
    prisma = withPerfMetrics(new PrismaClient({ adapter })) as PrismaClient;
  return prisma;
}
