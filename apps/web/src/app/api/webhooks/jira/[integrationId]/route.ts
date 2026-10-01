import { NextResponse } from "next/server";
import {
  extractJiraWebhookIssueKey,
  isJiraIssueDeletedEvent,
  isJiraWebhookTimestampFresh,
  JiraApiError,
  JiraPermissionDeniedError,
  JiraReauthRequiredError,
  recordJiraIssueDeletion,
  runJiraWebhookIngest,
  shouldIngestJiraWebhookEvent,
  type JiraWebhookPayload,
} from "@sla/jira";
import { getPrismaClient, withOrganizationSlaLock, type PrismaClient } from "@sla/db";
import { projectIssueRemoval, syncIntegration, type IntegrationRef } from "@sla/ingestion";
import { PROVIDERS, WEB_PROVIDERS } from "@/lib/providers";
import { caseRefResolverFor } from "@/lib/case-ref";
import { getJiraOAuthConfig } from "@/lib/jira-env";
import { computeWebhookPipeline, deliverWebhookNotifications } from "@/lib/webhook-pipeline";

export const maxDuration = 60;

/** Ends every active link to an issue the webhook reports gone, under the organization lock. */
async function unlinkDeletedIssue(
  prisma: PrismaClient,
  integration: { id: string; organizationId: string },
  issueKey: string,
): Promise<void> {
  await withOrganizationSlaLock(prisma, integration.organizationId, async () => {
    const removal = await recordJiraIssueDeletion(prisma, integration.id, issueKey);
    if (removal) await projectIssueRemoval(prisma, removal);
  });
}

/**
 * Jira webhook receiver (roadmap step 20). Unauthenticated by session — Jira
 * calls this directly. Classic Jira webhooks (registered manually by the
 * customer under Jira admin: Settings > System > WebHooks — there is no
 * self-service REST registration under this app's read-only OAuth scope)
 * are authenticated by the integration's `webhookSecret`, which the customer
 * pastes into the webhook's "Secret" field; Jira signs each delivery with it
 * (`X-Hub-Signature`, roadmap step 43). Webhooks set up before that step
 * carry the same secret as `?secret=` in the URL instead, still accepted as
 * a fallback when no signature header is present.
 *
 * On success this runs the full poll-cycle tail (ingest → correlate →
 * normalize → commitments → evaluation → notifications) for one issue,
 * synchronously — the 5-minute active-set poll and 60-minute reconciliation
 * sweep (roadmap step 7) keep running unchanged as the safety net for missed
 * or out-of-order deliveries. Correlation, normalization and the pipeline
 * tail run under `withOrganizationSlaLock` (E-3): a concurrent worker cycle
 * or another webhook for the same organization waits rather than racing on
 * the same Case/NormalizedEvent/Commitment rows. Ingest itself is excluded —
 * network-bound and idempotent, so it never needs to wait.
 */
export async function POST(request: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  const prisma = getPrismaClient();

  const integration = await prisma.integration.findUnique({ where: { id: integrationId } });
  if (!integration || integration.provider !== "jira" || !integration.webhookSecret) {
    return NextResponse.json({ error: "Unknown webhook endpoint" }, { status: 404 });
  }

  // The adapter reads the raw body (the signature covers those exact bytes)
  // from a clone, so it is verified before, and independently of, JSON parsing.
  // A signed delivery must verify on its own; a bad signature never falls
  // through to the legacy query-string check.
  const authenticated = await WEB_PROVIDERS.jira.verifyWebhook!(request.clone(), integration.webhookSecret);
  if (!authenticated) {
    return NextResponse.json({ error: "Invalid webhook signature or secret" }, { status: 401 });
  }
  const rawBody = await request.text();

  // A disconnected integration has no credentials to ingest with — accept
  // the delivery (so it doesn't show as a failing webhook in Jira admin and
  // get retried forever) but do nothing with it.
  if (integration.status === "disconnected") {
    return NextResponse.json({ status: "ignored", reason: "integration disconnected" });
  }

  let payload: JiraWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as JiraWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isJiraWebhookTimestampFresh(payload)) {
    return NextResponse.json({ error: "Webhook timestamp missing or expired" }, { status: 401 });
  }

  // Checked before shouldIngestJiraWebhookEvent's gate: the issue is gone,
  // so it must never reach runJiraWebhookIngest's refetch — this is its own
  // handling, not silent ignoring (roadmap task 2.6).
  if (isJiraIssueDeletedEvent(payload)) {
    const deletedIssueKey = extractJiraWebhookIssueKey(payload);
    if (deletedIssueKey === null) {
      return NextResponse.json({ error: "No issue key found in webhook payload" }, { status: 400 });
    }
    await unlinkDeletedIssue(prisma, integration, deletedIssueKey);
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date(), lastSyncError: null },
    });
    return NextResponse.json({ status: "processed", issueKey: deletedIssueKey, reason: "issue deleted" });
  }

  if (!shouldIngestJiraWebhookEvent(payload)) {
    return NextResponse.json({ status: "ignored", reason: "event type not ingested" });
  }

  const issueKey = extractJiraWebhookIssueKey(payload);
  if (issueKey === null) {
    return NextResponse.json({ error: "No issue key found in webhook payload" }, { status: 400 });
  }

  let config;
  try {
    config = await getJiraOAuthConfig(integration.organizationId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Jira OAuth is not configured" },
      { status: 500 },
    );
  }

  const integrationRef: IntegrationRef = {
    id: integration.id,
    organizationId: integration.organizationId,
    provider: integration.provider,
    status: integration.status,
  };

  try {
    await runJiraWebhookIngest(prisma, integration.id, config, issueKey);
    const { result, claims } = await withOrganizationSlaLock(prisma, integration.organizationId, async () => {
      await syncIntegration(PROVIDERS.jira, {
        prisma,
        integration: integrationRef,
        mode: "full",
        resolveCaseRef: await caseRefResolverFor(prisma, integration.organizationId),
        externalIds: [issueKey],
      });
      // Every case this issue is (or was, if just unlinked) linked to —
      // those are the only cases the issue's events can have changed.
      const links = await prisma.caseLink.findMany({
        where: { system: "jira", externalId: issueKey, case: { organizationId: integration.organizationId } },
        select: { caseId: true },
      });
      return computeWebhookPipeline(prisma, integration.organizationId, {
        caseIds: [...new Set(links.map((l) => l.caseId))],
      });
    });
    // Alerts go out after the lock is released (their claim rows were inserted inside it).
    const pipeline = await deliverWebhookNotifications(prisma, result, claims);

    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date(), lastSyncError: null },
    });
    // Access is evidently back — same compare-and-set self-clearing rule as
    // the worker cycle (a no-op unless the row is still `permission_denied`).
    await prisma.integration.updateMany({
      where: { id: integration.id, status: "permission_denied" },
      data: { status: "connected" },
    });

    return NextResponse.json({ status: "processed", issueKey, ...pipeline });
  } catch (error) {
    // An issue the webhook referenced but that 404s on direct fetch (deleted
    // between the event firing and our fetch) is a normal race, not a
    // failure to retry — but it's the same "issue is gone" fact as an
    // explicit jira:issue_deleted event, so it gets the same handling
    // instead of being silently swallowed (roadmap task 2.6).
    if (error instanceof JiraApiError && error.status === 404) {
      await unlinkDeletedIssue(prisma, integration, issueKey);
      return NextResponse.json({ status: "ignored", reason: "issue not found" });
    }

    if (error instanceof JiraReauthRequiredError) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { status: "reauth_required", lastSyncAt: new Date(), lastSyncError: "Jira needs to be reconnected" },
      });
      // Accepted, not retried: reconnecting requires a human, which no
      // number of Jira retries will produce.
      return NextResponse.json({ status: "ignored", reason: "reauth required" });
    }

    if (error instanceof JiraPermissionDeniedError) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncError: "Jira denied access — the connecting user's Jira permissions may have changed",
        },
      });
      // Compare-and-set, like the worker cycle: never overwrites a concurrent disconnect/reauth.
      await prisma.integration.updateMany({
        where: { id: integration.id, status: "connected" },
        data: { status: "permission_denied" },
      });
      // Accepted, not retried: restoring the user's access is a human step.
      // The next clean worker cycle clears the status on its own.
      return NextResponse.json({ status: "ignored", reason: "permission denied" });
    }

    const message = error instanceof Error ? error.message : String(error);
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date(), lastSyncError: message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
