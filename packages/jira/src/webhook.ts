import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@sla/db";
import type { IssueRemoval } from "@sla/ingestion";
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
 * and `recordJiraIssueDeletion` below (roadmap task 2.6) — since the
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
 * Records the fact "this issue was found deleted" and describes the removal
 * for the shared projector (`projectIssueRemoval`), which ends every active
 * CaseLink for the issue and emits the matching `issue_unlinked` events — the
 * Jira-side mirror of a Zendesk ticket deletion. Unlike a Zendesk ticket, a
 * Jira issue is never a Case's anchor — only ever a linked engineering leg
 * (see ./correlate.ts) — so there is no Case to soft-delete; ending its
 * CaseLink(s) is the complete analogue. Used both for an explicit
 * `jira:issue_deleted` webhook event and for a 404 on the targeted refetch
 * (an issue deleted between the webhook firing and the fetch): the same fact
 * from two different angles (roadmap task 2.6).
 *
 * Null (and nothing recorded) when nothing is currently linked — already
 * unlinked, or never was — so a redelivered or duplicate webhook is harmless.
 * The only write is the `RawEvent` the `issue_unlinked` events cite: the
 * source-record FK is required, and with the issue gone there is no fetched
 * payload to point at (see `mapIssueDeletedToRawEvent`).
 */
export async function recordJiraIssueDeletion(
  prisma: PrismaClient,
  integrationId: string,
  issueKey: string,
): Promise<IssueRemoval | null> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const active = await prisma.caseLink.count({
    where: { system: "jira", externalId: issueKey, unlinkedAt: null, case: { organizationId: integration.organizationId } },
  });
  if (active === 0) return null;

  const deletionEvent = mapIssueDeletedToRawEvent(issueKey);
  const rawEvent = await prisma.rawEvent.create({
    data: {
      integrationId,
      providerEventId: deletionEvent.providerEventId,
      sourceHash: deletionEvent.sourceHash,
      payload: deletionEvent.payload as Prisma.InputJsonValue,
    },
  });
  return {
    organizationId: integration.organizationId,
    system: "jira",
    externalId: issueKey,
    rawEventId: rawEvent.id,
    observedAt: rawEvent.fetchedAt,
    sourceRole: JIRA_SOURCE_ROLE,
  };
}

/**
 * Targeted refetch of one issue, triggered by an inbound webhook (roadmap
 * step 20) rather than the JQL-windowed search the two-speed poller uses.
 * Deliberately never touches Integration.cursor — that watermark belongs to
 * the incremental search stream `runJiraBackfill` advances. Writes land
 * through the same RawEvent mapping functions the poller uses, so a
 * subsequent correlation/normalization pass picks them up
 * identically whether the issue arrived via poll or webhook.
 *
 * Also refetches the site's full status list, same as `runJiraBackfill`'s
 * `backfillStatuses`: a tenant can add a custom status and transition an
 * issue onto it between poll cycles, and the synchronous
 * normalization this feeds into (see the webhook route) needs that
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
