/**
 * Everything Elapsed sends by email goes through this package, and only one
 * way: `sendEmail({ template, data, to, smtp })`. The SMTP transport and the
 * layout are deliberately not exported — see `transport.ts` and `layout.ts`.
 */
export { sendEmail, type SendEmailInput } from "./send";
export { renderEmail, UnknownEmailTemplateError, type EmailRenderContext } from "./render";
export { UnrenderedEmailError, type RenderedEmail } from "./rendered";
export { verifyEmailConfig, type SendOptions } from "./transport";
export { EMAIL_TEMPLATE_IDS } from "./templates";
export type {
  EmailChangeVerificationData,
  EmailTemplateData,
  EmailTemplateId,
  EmailVerificationData,
  InvitationData,
  MonthlyReportData,
  OpsAlertData,
  PasswordResetData,
  SlaAlertData,
  SlaAlertSeverity,
  SmtpTestData,
  TrialEndedData,
} from "./templates";
export type { EmailRequest, EmailTemplateRequest } from "./request";
export { strong, type DetailRow, type EmailBlock, type InlineText, type RichText, type Stat, type TableRow } from "./blocks";
export { EMAIL_BRAND, type EmailCategory, type EmailSwatch, type EmailTone } from "./brand";
export { InvalidEmailUrlError } from "./html";
export { normalizeAppUrl, resolveAppUrl } from "./app-url";
export {
  SmtpDestinationNotAllowedError,
  isPublicAddress,
  privateSmtpHostsAllowed,
  resolvePublicSmtpAddress,
} from "./destination";
export { loadDeploymentSmtpConfig, DeploymentSmtpNotConfiguredError } from "./deployment-config";
export type { EmailAttachment, EmailConfig, EmailSecurity } from "./types";
