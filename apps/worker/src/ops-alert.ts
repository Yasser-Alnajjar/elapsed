import { sendEmail, loadDeploymentSmtpConfig, DeploymentSmtpNotConfiguredError, type EmailConfig } from "@sla/email";

/**
 * Deployment-owner-level alerting ("email/Slack to you, not the customer" —
 * roadmap step 29), which is why this reads deployment-level config rather
 * than the per-organization `SlackIntegration`/`OrganizationEmailSettings`
 * models: those are customer-facing channels for SLA breach notifications,
 * and reusing them would mean paging every customer's Slack channel when
 * *our* worker stalls. `@sla/slack`'s `postMessage` also can't be reused
 * as-is here even if it could — it needs a resolved OAuth bot token +
 * channel id from a completed per-org Slack app install, not a single ops
 * channel — so Slack delivery below is a plain incoming-webhook POST
 * instead.
 *
 * The email channel's SMTP transport is `@sla/email`'s shared
 * `loadDeploymentSmtpConfig` (`DEPLOYMENT_SMTP_*`) — the same deployment-
 * owned mailer `apps/web` uses for invitations/password resets/email
 * verification, not a separate credential set. There's no technical reason
 * for a second deployment-owned SMTP transport once both consumers already
 * go through the same `sendEmail`/`EmailConfig`; the boundary that actually
 * matters — customer-owned `OrganizationEmailSettings` vs. deployment-owned
 * — is untouched by sharing this one.
 */
export interface OpsAlertConfig {
  slackWebhookUrl: string | null;
  email: { to: string; smtp: EmailConfig } | null;
}

/**
 * Returns null when neither channel is configured — callers treat that as
 * "nothing to alert through" and skip the check entirely. The email channel
 * specifically requires `OPS_ALERT_EMAIL`; if that's set but the shared
 * `DEPLOYMENT_SMTP_*` isn't configured, email alerting is simply off (the
 * same "missing credentials mean skip" convention used everywhere else in
 * this config) rather than an error — only a genuinely unexpected failure
 * from the loader propagates.
 */
export function loadOpsAlertConfig(): OpsAlertConfig | null {
  const slackWebhookUrl = process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? null;

  const to = process.env.OPS_ALERT_EMAIL ?? null;
  let email: OpsAlertConfig["email"] = null;
  if (to) {
    try {
      email = { to, smtp: loadDeploymentSmtpConfig() };
    } catch (error) {
      if (!(error instanceof DeploymentSmtpNotConfiguredError)) throw error;
    }
  }

  if (!slackWebhookUrl && !email) return null;
  return { slackWebhookUrl, email };
}

export interface OpsAlert {
  subject: string;
  message: string;
  /** `recovered` closes out an earlier alert. Defaults to `alert`. */
  kind?: "alert" | "recovered";
}

/**
 * Sends to every configured channel independently and best-effort: a
 * delivery failure here is logged (and would already have been captured to
 * Sentry by the caller, since the underlying condition is itself
 * alert-worthy) but never thrown — an ops alert about a stalled worker must
 * not itself crash the worker's watchdog loop.
 */
export async function sendOpsAlert(config: OpsAlertConfig | null, alert: OpsAlert): Promise<void> {
  if (!config) return;

  if (config.slackWebhookUrl) {
    try {
      const response = await fetch(config.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${alert.subject}*\n${alert.message}` }),
      });
      if (!response.ok) {
        console.error(JSON.stringify({ event: "ops_alert_slack_failed", status: response.status }));
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "ops_alert_slack_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (config.email) {
    try {
      await sendEmail({
        smtp: config.email.smtp,
        to: [config.email.to],
        template: "ops-alert",
        data: { subject: alert.subject, message: alert.message, ...(alert.kind ? { kind: alert.kind } : {}) },
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "ops_alert_email_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
