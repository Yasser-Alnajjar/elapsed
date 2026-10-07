import { emailChangeVerificationTemplate } from "./email-change-verification";
import { emailVerificationTemplate } from "./email-verification";
import { invitationTemplate } from "./invitation";
import { monthlyReportTemplate } from "./monthly-report";
import { opsAlertTemplate } from "./ops-alert";
import { passwordResetTemplate } from "./password-reset";
import { slaAlertTemplate } from "./sla-alert";
import { smtpTestTemplate } from "./smtp-test";
import { trialEndedTemplate } from "./trial-ended";
import type { EmailTemplate } from "../template";

/**
 * Every email Elapsed can send. `sendEmail` accepts only these ids, so adding
 * an email means adding a template here: there is no other way to put one on
 * the wire. The data type of each id is inferred from its template.
 */
export const EMAIL_TEMPLATES = {
  "email-verification": emailVerificationTemplate,
  "email-change-verification": emailChangeVerificationTemplate,
  "password-reset": passwordResetTemplate,
  invitation: invitationTemplate,
  "trial-ended": trialEndedTemplate,
  "ops-alert": opsAlertTemplate,
  "sla-alert": slaAlertTemplate,
  "monthly-report": monthlyReportTemplate,
  "smtp-test": smtpTestTemplate,
} as const;

export type EmailTemplateId = keyof typeof EMAIL_TEMPLATES;

export type EmailTemplateData<K extends EmailTemplateId> = (typeof EMAIL_TEMPLATES)[K] extends EmailTemplate<infer Data> ? Data : never;

export const EMAIL_TEMPLATE_IDS = Object.keys(EMAIL_TEMPLATES) as EmailTemplateId[];

export type { EmailVerificationData } from "./email-verification";
export type { EmailChangeVerificationData } from "./email-change-verification";
export type { PasswordResetData } from "./password-reset";
export type { InvitationData } from "./invitation";
export type { TrialEndedData } from "./trial-ended";
export type { OpsAlertData } from "./ops-alert";
export type { SlaAlertData, SlaAlertSeverity } from "./sla-alert";
export type { MonthlyReportData } from "./monthly-report";
export type { SmtpTestData } from "./smtp-test";
