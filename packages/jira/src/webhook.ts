import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@sla/db";
import { JiraClient } from "./client";
import type { JiraOAuthConfig } from "./oauth";
import {
  mapChangelogHistoryToRawEvent,
  mapIssueDeletedToRawEvent,
  mapIssueToRawEvent,
  mapRemoteLinkManifestToRawEvent,
  mapRemoteLinkToRawEvent,
  mapStatusToRawEvent,
  type RawEventInput,
} from "./rawEvents";
import { loadFreshJiraCredentials, refreshAfterUnauthorized } from "./tokenLifecycle";
import { JIRA_SOURCE_ROLE } from "./source-role";

/** Random per-integration secret, generated once at connect and never rotated on reconnect (see Integration.webhookSecret's doc comment). */
export function generateWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Jira admin webhooks (Settings > System > WebHooks) accept a "Secret" the
 * admin types in; Jira then signs each delivery with HMAC-SHA256 over the
 * raw body and sends `X-Hub-Signature: sha256=<hex>` (WebSub format, per
 * Atlassian's "Secure admin webhooks" docs). The customer pastes our
 * per-integration `webhookSecret` into that field, so no secret travels in
 * the URL. Only `sha256` is accepted; anything else fails closed.
 */
export function verifyJiraWebhookSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const separator = header.indexOf("=");
  if (separator === -1) return false;
  const method = header.slice(0, separator).trim().toLowerCase();
  const signature = header.slice(separator + 1).trim().toLowerCase();
  if (method !== "sha256" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/**
 * Legacy fallback (roadmap step 20) for webhooks configured before step 43,
 * whose URL carries the shared secret as `?secret=`. Kept so existing
 * customer webhooks keep working; new setups use the signed form above.
 * Constant-time compare so a partial match can't be timed out of the
 * endpoint.
 */
export function verifyJiraWebhookSecret(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Jira classic webhook events this receiver refetches the issue for.
 * `jira:issue_deleted` is handled separately — see `isJiraIssueDeletedEvent`
 * and `markCaseLinksUnlinkedForIssue` below (roadmap task 2.6) — since the
 * issue is gone by the time a refetch would run; anything else Jira might
 * send to the same URL is accepted but ignored.
 */
const INGESTIBLE_EVENTS = new Set(["jira:issue_created", "jira:issue_updated"]);

export interface JiraWebhookPayload {
  webhookEvent?: string;
  timestamp?: number;
  issue?: { key?: string };
}

export function shouldIngestJiraWebhookEvent(payload: JiraWebhookPayload): boolean {
  return typeof payload.webhookEvent === "string" && INGESTIBLE_EVENTS.has(payload.webhookEvent);
}

/** `jira:issue_deleted` — checked before `shouldIngestJiraWebhookEvent`'s gate, since this event needs its own handling, not silent ignoring (roadmap task 2.6). */
export function isJiraIssueDeletedEvent(payload: JiraWebhookPayload): boolean {
  return payload.webhookEvent === "jira:issue_deleted";
}

export function extractJiraWebhookIssueKey(payload: JiraWebhookPayload): string | null {
  const key = payload.issue?.key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * Cheap replay mitigation (roadmap step 30) alongside `verifyJiraWebhookSecret`
 * above: a captured request — secret included — replayed later is rejected
 * once its payload's timestamp has aged out. Unlike Zendesk, this needs no
 * customer-side configuration change: classic Jira webhooks carry a
 * top-level `timestamp` (epoch milliseconds) on every callback per
 * Atlassian's own webhook docs. Missing or unparseable timestamps count as
 * stale — fail closed, matching `verifyJiraWebhookSecret`'s own default-deny
 * shape.
 */
export function isJiraWebhookTimestampFresh(payload: JiraWebhookPayload, now: number = Date.now(), maxAgeMs = 5 * 60_000): boolean {
  const { timestamp } = payload;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
  return Math.abs(now - timestamp) <= maxAgeMs;
}

export interface WebhookIngestResult {
  issuesFetched: number;
  changelogHistoriesFetched: number;
  remoteLinksFetched: number;
  statusesFetched: number;
}

/**
 * Marks every currently-active CaseLink for `issueKey` in this integration's
 * organization `unlinkedAt` and emits a matching `issue_unlinked` event for
 * each — the Jira-side mirror of `markCaseDeletedForTicket` (packages/
 * zendesk/src/webhook.ts). Unlike a Zendesk ticket, a Jira issue is never a
 * Case's anchor — only ever a linked engineering leg (see ./correlate.ts) —
 * so there's no Case to soft-delete here; ending its CaseLink(s) is the
 * complete analogue. Used both for an explicit `jira:issue_deleted` webhook
 * event and for a 404 on the targeted refetch (an issue deleted between the
 * webhook firing and the fetch) — both are the same fact from two different
 * angles (roadmap task 2.6).
 *
 * A no-op when nothing is currently linked (already unlinked, or never was)
 * — safe against a redelivered/duplicate webhook, since the query only ever
 * finds rows with `unlinkedAt: null`.
 */
export async function markCaseLinksUnlinkedForIssue(
  prisma: PrismaClient,
  integrationId: string,
  issueKey: string,
): Promise<void> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const activeCaseLinks = await prisma.caseLink.findMany({
    where: { system: "jira", externalId: issueKey, unlinkedAt: null, case: { organizationId: integration.organizationId } },
    select: { id: true, caseId: true },
  });
  if (activeCaseLinks.length === 0) return;

  // NormalizedEvent.sourceRawEventId is a required FK — there's no fetched
  // payload to cite here (the issue is gone), so this RawEvent documents the
  // deletion itself (see mapIssueDeletedToRawEvent's doc comment).
  const deletionEvent = mapIssueDeletedToRawEvent(issueKey);
  const rawEvent = await prisma.rawEvent.create({
    data: {
      integrationId,
      providerEventId: deletionEvent.providerEventId,
      sourceHash: deletionEvent.sourceHash,
      payload: deletionEvent.payload as Prisma.InputJsonValue,
    },
  });

  await prisma.$transaction(
    activeCaseLinks.flatMap((caseLink) => [
      prisma.caseLink.update({ where: { id: caseLink.id }, data: { unlinkedAt: rawEvent.fetchedAt } }),
      prisma.normalizedEvent.create({
        data: {
          caseId: caseLink.caseId,
          sourceRawEventId: rawEvent.id,
          type: "issue_unlinked" as const,
          occurredAt: rawEvent.fetchedAt,
          actor: "system" as const,
          system: "jira" as const,
          sourceRole: JIRA_SOURCE_ROLE,
          fromState: null,
          toState: null,
        },
      }),
    ]),
  );
}

/**
 * Targeted refetch of one issue, triggered by an inbound webhook (roadmap
 * step 20) rather than the JQL-windowed search the two-speed poller uses.
 * Deliberately never touches Integration.cursor — that watermark belongs to
 * the incremental search stream `runJiraBackfill` advances. Writes land
 * through the same RawEvent mapping functions the poller uses, so a
 * subsequent `runJiraCorrelation`/`runJiraNormalization` call picks them up
 * identically whether the issue arrived via poll or webhook.
 *
 * Also refetches the site's full status list, same as `runJiraBackfill`'s
 * `backfillStatuses`: a tenant can add a custom status and transition an
 * issue onto it between poll cycles, and the synchronous
 * `runJiraNormalization` this feeds into (see the webhook route) needs that
 * status id resolvable *now* — otherwise the issue's events fail to
 * normalize and its Timeline silently stops updating until the next poll.
 */
export async function runJiraWebhookIngest(
  prisma: PrismaClient,
  integrationId: string,
  config: JiraOAuthConfig,
  issueKey: string,
): Promise<WebhookIngestResult> {
  const credentials = await loadFreshJiraCredentials(prisma, integrationId, config);
  const client = new JiraClient(credentials, {
    onUnauthorized: (failed) => refreshAfterUnauthorized(prisma, integrationId, config, failed),
  });

  const statuses = await client.fetchStatuses();
  const issue = await client.fetchIssue(issueKey);
  const rawEvents: RawEventInput[] = [...statuses.map(mapStatusToRawEvent), mapIssueToRawEvent(issue)];

  let changelogHistoriesFetched = 0;
  let startAt = 0;
  for (;;) {
    const page = await client.fetchChangelogPage(issueKey, startAt);
    rawEvents.push(...page.values.map((history) => mapChangelogHistoryToRawEvent(issueKey, history)));
    changelogHistoriesFetched += page.values.length;
    startAt += page.values.length;
    if (page.isLast || page.values.length === 0) break;
  }

  const remoteLinks = await client.fetchRemoteLinks(issueKey);
  rawEvents.push(...remoteLinks.map((link) => mapRemoteLinkToRawEvent(issueKey, link)));
  // Same per-issue full fetch the manifest-diff sweep needs (roadmap task
  // 2.6) — see mapRemoteLinkManifestToRawEvent's doc comment.
  rawEvents.push(mapRemoteLinkManifestToRawEvent(issueKey, remoteLinks.map((link) => link.id)));

  await prisma.rawEvent.createMany({
    data: rawEvents.map((input) => ({
      integrationId,
      providerEventId: input.providerEventId,
      sourceHash: input.sourceHash,
      payload: input.payload as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });

  return {
    issuesFetched: 1,
    changelogHistoriesFetched,
    remoteLinksFetched: remoteLinks.length,
    statusesFetched: statuses.length,
  };
}
