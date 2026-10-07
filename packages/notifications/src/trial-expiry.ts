import { markTrialExpiry, settleTrialExpiryNotice, type PrismaClient } from "@sla/db";
import { loadDeploymentSmtpConfig, sendEmail, type EmailConfig, type EmailRequest } from "@sla/email";

/**
 * The owner email for a lapsed trial (N6.4, D27), sent at most once per
 * organization and trial end date.
 *
 * Idempotency is `markTrialExpiry`: it claims the `trial_expired`
 * `EntitlementEvent` by insert, so two ticks or two workers cannot both send.
 * A failed send releases the claim and the next reconciliation tick retries.
 * It runs from the reconciliation tick and changes nothing about what the
 * worker does for the organization: monitoring and alerts continue.
 * Sent through the deployment's shared SMTP, like the other account-lifecycle
 * mail, because the customer's own SMTP is for SLA alerts and may not exist.
 */

export type TrialExpiryNoticeOutcome = "not_expired" | "already_handled" | "sent" | "failed" | "no_owner";

export interface TrialExpiryNoticeOptions {
  appUrl: string | null;
  now?: Date;
  /** Awaited after the claim and before sending: the worker confirms it still owns the organization. */
  beforeSend?: () => Promise<void>;
  loadConfig?: () => EmailConfig;
  send?: (config: EmailConfig, request: EmailRequest<"trial-ended">) => Promise<void>;
}

export function buildTrialExpiryEmail(input: { to: string; organizationName: string; appUrl: string | null }): EmailRequest<"trial-ended"> {
  return {
    to: [input.to],
    template: "trial-ended",
    data: {
      organizationName: input.organizationName,
      pricingUrl: input.appUrl ? new URL("/pricing", input.appUrl).toString() : null,
    },
  };
}

export async function deliverTrialExpiryNotice(
  prisma: PrismaClient,
  organizationId: string,
  options: TrialExpiryNoticeOptions,
): Promise<TrialExpiryNoticeOutcome> {
  const now = options.now ?? new Date();
  const result = await markTrialExpiry(prisma, organizationId, now);
  if (result.outcome !== "marked") return result.outcome;
  const trialEndedAt = result.trialEndedAt!;

  try {
    if (result.ownerEmails.length === 0) {
      // Nobody to email. The event stays claimed (so it is not retried every tick) with no `notifiedAt`.
      return "no_owner";
    }
    await options.beforeSend?.();

    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const config = (options.loadConfig ?? loadDeploymentSmtpConfig)();
    const send = options.send ?? ((smtp, request) => sendEmail({ ...request, smtp, appUrl: options.appUrl }));

    // One message per owner, so no owner sees who else got it. One delivered is enough to settle.
    let delivered = 0;
    let firstError: unknown = null;
    for (const to of result.ownerEmails) {
      try {
        await send(config, buildTrialExpiryEmail({ to, organizationName: organization?.name ?? "your organization", appUrl: options.appUrl }));
        delivered += 1;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (delivered === 0) throw firstError;

    await settleTrialExpiryNotice(prisma, organizationId, trialEndedAt, "sent", now);
    return "sent";
  } catch (error) {
    // Release the claim so a later tick retries; surface the cause to the caller's logger.
    await settleTrialExpiryNotice(prisma, organizationId, trialEndedAt, "failed", now).catch(() => undefined);
    throw error;
  }
}
