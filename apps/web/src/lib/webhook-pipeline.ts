import {
  runCommitmentPipeline,
  runCommitmentReResolutionPipeline,
  runEvaluationPipeline,
  runNextReplyCyclePipeline,
} from "@sla/commitments";
import { claimNotifications, deliverClaimedNotifications, type NotificationClaims } from "@sla/notifications";
import type { PrismaClient } from "@sla/db";

export interface WebhookPipelineResult {
  commitmentsCreated: number;
  commitmentsReResolved: number;
  cyclesCreated: number;
  cyclesCancelled: number;
  cyclesRestored: number;
  commitmentsConsidered: number;
  evaluationsCreated: number;
  commitmentsFinalized: number;
  notificationsSent: number;
  notificationsFailed: { commitmentId: string; threshold: number; error: string }[];
}

/**
 * The commitment/cycle/evaluation/notification tail of one worker cycle
 * (`apps/worker/src/cycle.ts`'s per-organization body), run synchronously
 * right after a webhook receiver ingests one fresh ticket/issue — this is
 * what actually "closes the gap" roadmap step 20 is for: writing a RawEvent
 * alone does nothing until something re-evaluates commitments and dispatches
 * alerts. Scoped to `active` evaluation, same as the 5-minute poll, since a
 * webhook is inherently about one already-open case, not a full sweep.
 * Notification dedup is safe under concurrent execution with the worker's
 * own cycle: both paths go through the same `@@unique([commitmentId,
 * threshold])`-guarded `runNotificationPipeline`.
 *
 * Re-resolution runs right after commitment creation and before Next Reply
 * cycle derivation (Active-Commitment Re-Resolution): a webhook can carry a
 * policy-driving attribute change (priority, customer/organization, tier)
 * on an already-open case, and a future Next Reply cycle needs its anchor
 * commitment's policy already re-resolved to pick up the new target.
 *
 * One `asOf` snapshot for commitment creation, re-resolution, Next Reply
 * cycle derivation, and evaluation, so all four agree on "now" for this
 * webhook.
 *
 * Split in two (`computeWebhookPipeline` / `deliverWebhookNotifications`) so
 * the receivers can send alerts after releasing the organization lock, and
 * scoped to the touched cases (`WebhookPipelineOptions.caseIds`) so the lock
 * is held for one delivery's worth of work, not the whole organization's.
 */
export interface WebhookPipelineOptions {
  /**
   * The cases this delivery touched (roadmap 7.7 Phase 3): every stage is
   * limited to them, so the lock is held for one ticket's worth of work
   * instead of the whole organization's. An empty list is a valid scope
   * ("touched nothing") and every stage no-ops. Omit to process the whole
   * organization.
   */
  caseIds?: readonly string[];
}

/**
 * The lock-holding half of the tail: commitments, re-resolution, Next Reply
 * cycles, evaluation and — as DB-only claim rows — notifications. Returns the
 * claims for `deliverWebhookNotifications`, which sends them *after* the
 * caller has released the organization lock, so a slow Slack/SMTP call never
 * makes the next delivery for this organization wait on it.
 */
export async function computeWebhookPipeline(
  prisma: PrismaClient,
  organizationId: string,
  options: WebhookPipelineOptions = {},
): Promise<{ result: WebhookPipelineResult; claims: NotificationClaims }> {
  const asOf = new Date().toISOString();
  const { caseIds } = options;

  const commitments = await runCommitmentPipeline(prisma, organizationId, { caseIds });
  const reResolution = await runCommitmentReResolutionPipeline(prisma, organizationId, { asOf, caseIds });
  const cycles = await runNextReplyCyclePipeline(prisma, organizationId, { asOf, caseIds });
  const evaluations = await runEvaluationPipeline(prisma, organizationId, { asOf, scope: "active", caseIds });
  // I-8: this tail previously omitted `appUrl` entirely, so a webhook-
  // triggered alert's email carried no "View ticket" link — only the
  // worker's own poll cycle (apps/worker/src/cycle.ts) passed it. Read
  // directly from the env, like the worker does (`config.appUrl`), rather
  // than `getAppUrl()`: that throws when unset, and a missing link must
  // never fail sending the alert itself.
  const claims = await claimNotifications(prisma, organizationId, evaluations.notificationCandidates, {
    appUrl: process.env.NEXTAUTH_URL ?? null,
  });

  return {
    result: {
      commitmentsCreated: commitments.commitmentsCreated,
      commitmentsReResolved: reResolution.commitmentsUpdated,
      cyclesCreated: cycles.cyclesCreated,
      cyclesCancelled: cycles.cyclesCancelled,
      cyclesRestored: cycles.cyclesRestored,
      commitmentsConsidered: evaluations.commitmentsConsidered,
      evaluationsCreated: evaluations.evaluationsCreated,
      commitmentsFinalized: evaluations.commitmentsFinalized,
      notificationsSent: 0,
      notificationsFailed: [],
    },
    claims,
  };
}

/** The lock-free half of the tail: sends what `computeWebhookPipeline` claimed and folds the outcome into its result. */
export async function deliverWebhookNotifications(
  prisma: PrismaClient,
  result: WebhookPipelineResult,
  claims: NotificationClaims,
): Promise<WebhookPipelineResult> {
  const notifications = await deliverClaimedNotifications(prisma, claims);
  return {
    ...result,
    notificationsSent: notifications.notificationsSent,
    notificationsFailed: notifications.notificationsFailed,
  };
}
