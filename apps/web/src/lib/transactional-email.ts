import { sendEmail, loadDeploymentSmtpConfig, type EmailConfig, type EmailRequest } from "@sla/email";
import { errorMessage } from "./utils";

/**
 * Sends account-lifecycle email — invitations, password resets, email
 * verification (roadmap D8) — through the deployment's shared SMTP
 * (`DEPLOYMENT_SMTP_*`, loaded by `@sla/email`'s `loadDeploymentSmtpConfig`,
 * the same config apps/worker's ops alert uses). Deliberately separate from
 * `OrganizationEmailSettings` (per-org, opt-in, customer-owned, used only
 * for SLA breach/at-risk notifications): these flows can fire before an
 * organization has ever configured its own SMTP — the very first invite, or
 * a password reset for an owner who never opened Settings → Notifications —
 * so they cannot depend on optional per-tenant configuration. A missing
 * config or a delivery failure is logged as a structured operational error
 * and rethrown — never swallowed — so the caller (an invite/reset/
 * verification API route) can surface a real failure instead of reporting
 * success for an email that was never sent.
 *
 * Callers pass a template request (`{ to, template, data }`), never a subject
 * or a body: `@sla/email` renders every message inside the Elapsed layout.
 */
export async function sendTransactionalEmail(request: EmailRequest): Promise<void> {
  let config: EmailConfig;
  try {
    config = loadDeploymentSmtpConfig();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "transactional_email_not_configured",
        error: errorMessage(error),
      }),
    );
    throw error;
  }

  try {
    await sendEmail({ ...request, smtp: config });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "transactional_email_send_failed",
        error: errorMessage(error),
      }),
    );
    throw error;
  }
}
