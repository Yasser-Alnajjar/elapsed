export { sendEmail, verifyEmailConfig, type SendOptions } from "./client";
export {
  SmtpDestinationNotAllowedError,
  isPublicAddress,
  privateSmtpHostsAllowed,
  resolvePublicSmtpAddress,
} from "./destination";
export { loadDeploymentSmtpConfig, DeploymentSmtpNotConfiguredError } from "./deployment-config";
export type { EmailConfig, EmailMessage, EmailSecurity } from "./types";
