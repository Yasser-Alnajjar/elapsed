import { decryptToken, getEmailSettings, EmailSettingsUnreadableError, type PrismaClient } from "@sla/db";
import { postMessage } from "@sla/slack";
import { sendEmail, type EmailConfig } from "@sla/email";
import type { NotificationCandidate } from "@sla/commitments";
import { formatSlackMessage, formatEmailMessage } from "./format";

function toEmailConfig(settings: NonNullable<Awaited<ReturnType<typeof getEmailSettings>>>): EmailConfig {
  return {
    host: settings.host,
    port: settings.port,
    security: settings.security,
    user: settings.username,
    password: settings.password,
    from: settings.fromEmail,
    fromName: settings.fromName,
  };
}

export interface NotificationPipelineResult {
  notificationsSent: number;
  // Not connected, no channel/recipients configured yet, or already sent for
  // that (commitmentId, threshold) — the common, expected case once a
  // commitment has settled at a given threshold.
  notificationsSkipped: number;
  notificationsFailed: { commitmentId: string; threshold: number; error: string }[];
}

/** `Notification.channel` while a claim is held and sends are in flight — replaced by the delivered channel list once they finish. */
const CLAIMED_CHANNEL = "pending";

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends Slack and/or email alerts for notification candidates surfaced by
 * `runEvaluationPipeline` (Phase 13.7). Both channels share one dedup slot:
 * the `Notification` table's `@@unique([commitmentId, threshold])`
 * constraint guards "has this alert been dispatched at all", not
 * per-channel.
 *
 * Claim-before-send: the row is `create`d (with a placeholder `channel`)
 * *before* any Slack/email call, so a webhook-triggered pipeline and a
 * concurrent poll cycle racing on the same candidate can't both send — the
 * loser's `create` hits `P2002` and is counted as skipped, not failed. The
 * winner then attempts every configured channel and rewrites `channel` to
 * what actually delivered (e.g. `"slack,email"`); if every channel failed,
 * the claim is deleted so a later cycle retries. The in-memory pre-check
 * against existing rows only avoids needless work on later cycles — the
 * unique constraint is the real guarantee. Trade-off: a process that dies
 * between claiming and finishing the sends leaves a `"pending"` row, so
 * that alert is never retried — at-most-once, deliberately preferred over
 * paging a customer twice for one breach.
 *
 * Email credentials are loaded per organization from `OrganizationEmailSettings`
 * (the settings UI, roadmap: organization SMTP configuration) rather than a
 * deployment-wide `.env` — there is no fallback to deployment-level SMTP
 * variables, matching `SlackIntegration`'s per-organization, nullable
 * pattern: an organization that hasn't saved SMTP configuration just gets
 * no email channel, an unattended worker must not crash-loop over it. A row
 * that exists but can't be decrypted (`EmailSettingsUnreadableError` — a
 * rotated/missing `SMTP_ENCRYPTION_KEY`, or corrupted ciphertext) is treated
 * the same as "not configured": still no crash, Slack (if ready) still
 * fires.
 */
export interface NotificationPipelineOptions {
  /** Deployment base URL (`NEXTAUTH_URL`) — used only to build a "View ticket" link in the branded HTML email. Omit (or leave unconfigured) and emails send without that link. */
  appUrl?: string | null;
}

export async function runNotificationPipeline(
  prisma: PrismaClient,
  organizationId: string,
  candidates: NotificationCandidate[],
  options: NotificationPipelineOptions = {},
): Promise<NotificationPipelineResult> {
  const result: NotificationPipelineResult = { notificationsSent: 0, notificationsSkipped: 0, notificationsFailed: [] };
  if (candidates.length === 0) return result;

  const [slack, emailSettings] = await Promise.all([
    prisma.slackIntegration.findUnique({ where: { organizationId } }),
    getEmailSettings(prisma, organizationId).catch((error) => {
      if (error instanceof EmailSettingsUnreadableError) return null;
      throw error;
    }),
  ]);

  const slackReady = Boolean(slack?.channelId);
  const emailConfig = emailSettings ? toEmailConfig(emailSettings) : null;
  const recipients = emailConfig
    ? await prisma.user.findMany({ where: { organizationId }, select: { email: true } })
    : [];
  const emailTo = recipients.map((r) => r.email);
  const emailReady = Boolean(emailConfig) && emailTo.length > 0;

  if (!slackReady && !emailReady) {
    result.notificationsSkipped = candidates.length;
    return result;
  }

  const existing = await prisma.notification.findMany({
    where: { commitmentId: { in: candidates.map((c) => c.commitmentId) } },
    select: { commitmentId: true, threshold: true },
  });
  const alreadySent = new Set(existing.map((e) => `${e.commitmentId}:${e.threshold}`));
  const toSend = candidates.filter((c) => !alreadySent.has(`${c.commitmentId}:${c.threshold}`));
  result.notificationsSkipped += candidates.length - toSend.length;
  if (toSend.length === 0) return result;

  const caseRows = await prisma.case.findMany({
    where: { id: { in: [...new Set(toSend.map((c) => c.caseId))] }, deletedAt: null },
    select: { id: true, externalId: true, subject: true, customer: { select: { name: true } } },
  });
  const caseById = new Map(caseRows.map((c) => [c.id, c]));

  for (const candidate of toSend) {
    const caseRow = caseById.get(candidate.caseId);
    if (!caseRow) continue;

    let claim: { id: string };
    try {
      claim = await prisma.notification.create({
        data: { commitmentId: candidate.commitmentId, threshold: candidate.threshold, channel: CLAIMED_CHANNEL },
        select: { id: true },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      result.notificationsSkipped += 1;
      continue;
    }

    const context = {
      externalId: caseRow.externalId,
      customerName: caseRow.customer?.name ?? null,
      subject: caseRow.subject,
      // 3.9/E-19: shared by both channels — Slack alerts previously carried
      // no case link at all.
      caseUrl: options.appUrl ? `${options.appUrl}/cases/${caseRow.id}` : null,
    };
    const delivered: string[] = [];
    const errors: string[] = [];

    if (slackReady) {
      try {
        await postMessage(decryptToken(slack!.accessToken), slack!.channelId!, formatSlackMessage(candidate, context));
        delivered.push("slack");
      } catch (error) {
        errors.push(`slack: ${errorMessage(error)}`);
      }
    }

    if (emailReady) {
      const brand = { name: emailConfig!.fromName };
      const { subject, text, html } = formatEmailMessage(candidate, context, brand);
      // 3.10: one send per recipient, not everyone listed in one `To` — a
      // bad address for one recipient doesn't block the others, and no
      // recipient can see who else was alerted.
      const recipientErrors: string[] = [];
      let anyEmailSent = false;
      for (const recipient of emailTo) {
        try {
          await sendEmail(emailConfig!, { to: [recipient], subject, text, html });
          anyEmailSent = true;
        } catch (error) {
          recipientErrors.push(`${recipient}: ${errorMessage(error)}`);
        }
      }
      if (anyEmailSent) delivered.push("email");
      if (recipientErrors.length > 0) errors.push(`email: ${recipientErrors.join("; ")}`);
    }

    if (delivered.length === 0) {
      const errorMessageJoined = errors.join("; ");
      // Release the claim so a later cycle retries this alert, but keep a
      // durable record of the failure (Phase 6.4) — the claim row itself
      // can't serve that purpose, since it's deleted precisely so the retry
      // can happen.
      await prisma.$transaction([
        prisma.notification.delete({ where: { id: claim.id } }),
        prisma.notificationFailure.upsert({
          where: {
            commitmentId_threshold: { commitmentId: candidate.commitmentId, threshold: candidate.threshold },
          },
          create: { commitmentId: candidate.commitmentId, threshold: candidate.threshold, error: errorMessageJoined },
          update: { error: errorMessageJoined, attempts: { increment: 1 }, lastFailedAt: new Date() },
        }),
      ]);
      result.notificationsFailed.push({ commitmentId: candidate.commitmentId, threshold: candidate.threshold, error: errorMessageJoined });
      continue;
    }

    // A previously-failing candidate that just succeeded: clear its failure
    // record so the dashboard's failed-deliveries panel doesn't keep
    // reporting an alert that went out. Best-effort — the row may not exist.
    await prisma.$transaction([
      prisma.notification.update({ where: { id: claim.id }, data: { channel: delivered.join(",") } }),
      prisma.notificationFailure.deleteMany({
        where: { commitmentId: candidate.commitmentId, threshold: candidate.threshold },
      }),
    ]);
    result.notificationsSent += 1;
  }

  return result;
}
