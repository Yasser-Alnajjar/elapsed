import type { PrismaClient } from "@sla/db";
import type { CaseRefResolver, CorrelationOutput, LinkFact } from "@sla/ingestion";
import type { LinearAttachment, LinearIssue } from "./types";
import { LINEAR_SOURCE_ROLE } from "./source-role";

interface LatestAttachment {
  attachment: LinearAttachment;
  latestObservedAt: Date;
  /** Earliest time this attachment was ever observed — the best available proxy for when it was created, since Linear's attachment API carries no creation-observation timestamp distinct from the object's own `createdAt`. */
  firstObservedAt: Date;
  firstRawEventId: string;
}

/** `attachment:{issueId}:{attachmentId}:{hash}` — groups by (issueId, attachmentId), keeping the latest snapshot and the earliest-ever observation. */
function latestAttachmentsByKey(
  rows: { id: string; providerEventId: string; payload: unknown; fetchedAt: Date }[],
): Map<string, { issueId: string } & LatestAttachment> {
  const byKey = new Map<string, { issueId: string } & LatestAttachment>();
  for (const row of rows) {
    const parts = row.providerEventId.split(":");
    const issueId = parts[1];
    const attachmentId = parts[2];
    if (!issueId || !attachmentId) continue;
    const key = `${issueId}:${attachmentId}`;
    const attachment = row.payload as LinearAttachment;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        issueId,
        attachment,
        latestObservedAt: row.fetchedAt,
        firstRawEventId: row.id,
        firstObservedAt: row.fetchedAt,
      });
      continue;
    }

    if (row.fetchedAt < existing.firstObservedAt) {
      existing.firstObservedAt = row.fetchedAt;
      existing.firstRawEventId = row.id;
    }
    if (row.fetchedAt >= existing.latestObservedAt) {
      existing.latestObservedAt = row.fetchedAt;
      existing.attachment = attachment;
    }
  }
  return byKey;
}

/** Latest snapshot per issue id, from `issue:{issueId}:{hash}` RawEvents. */
function latestIssuesById(rows: { payload: unknown; fetchedAt: Date }[]): Map<string, LinearIssue> {
  const byId = new Map<string, { value: LinearIssue; fetchedAt: Date }>();
  for (const row of rows) {
    const value = row.payload as LinearIssue;
    const existing = byId.get(value.id);
    if (!existing || row.fetchedAt >= existing.fetchedAt) {
      byId.set(value.id, { value, fetchedAt: row.fetchedAt });
    }
  }
  return new Map([...byId.entries()].map(([id, entry]) => [id, entry.value]));
}

/**
 * Deterministic-tier correlator (Phase 15), mirroring `correlateJira`:
 * reads Linear attachments already ingested by the backfill/poll, and for
 * each one whose URL the caller's `resolveCaseRef` recognizes as a ticket of
 * one of this organization's own connected ticket sources, creates a
 * `certain`/`remote_link` CaseLink plus an `issue_linked` NormalizedEvent on
 * first sight. No fuzzy matching — an attachment no ticket source
 * recognizes, or whose ticket has no matching Case yet, is left unlinked
 * and counted, never guessed at. Which hosts and URL shapes count is each
 * ticket-source adapter's business (N1.13).
 *
 * Must run before `buildLinearBatch` is projected, which relies on the CaseLinks
 * created here to know which Case a Linear issue's events belong to.
 *
 * The CaseLink's `evidence` stores the linked issue's own `url` alongside
 * the attachment, because — unlike Jira (`siteUrl`) or Zendesk
 * (`subdomain`) — Linear's stored OAuth credentials carry no workspace URL
 * to reconstruct a browse link from later, so the URL is captured here at
 * correlation time instead.
 */
export async function correlateLinear(
  prisma: PrismaClient,
  integrationId: string,
  resolveCaseRef: CaseRefResolver | null,
): Promise<CorrelationOutput> {
  const output: CorrelationOutput = { links: [], sweeps: [], evaluated: 0, unmatched: {} };
  const unmatch = (reason: string) => (output.unmatched[reason] = (output.unmatched[reason] ?? 0) + 1);

  // No connected ticket source (the caller builds the resolver from the
  // organization's ticket-source integrations): nothing to correlate onto.
  if (!resolveCaseRef) return output;

  const [attachmentRows, issueRows] = await Promise.all([
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "attachment:" } },
      select: { id: true, providerEventId: true, payload: true, fetchedAt: true },
    }),
    prisma.rawEvent.findMany({
      where: { integrationId, providerEventId: { startsWith: "issue:" } },
      select: { payload: true, fetchedAt: true },
    }),
  ]);

  const latestAttachments = latestAttachmentsByKey(attachmentRows);
  const issuesById = latestIssuesById(issueRows);
  output.evaluated = latestAttachments.size;

  for (const { issueId, attachment, firstRawEventId, firstObservedAt } of latestAttachments.values()) {
    const ref = await resolveCaseRef(attachment.url);
    if (ref.kind === "unrecognized") {
      unmatch("unrecognizedUrl");
      continue;
    }

    const issue = issuesById.get(issueId);
    if (!issue) {
      unmatch("noIssueSnapshot");
      continue;
    }

    if (ref.kind === "no_case") {
      unmatch("noCase");
      continue;
    }

    const fact: LinkFact = {
      caseId: ref.caseId,
      system: "linear",
      externalId: issue.identifier,
      method: "remote_link",
      methodOnUpdate: "keep",
      // The issue's own `url` is captured at link time because Linear's stored
      // OAuth credentials carry no workspace URL to rebuild a browse link from.
      evidence: { attachment, issueUrl: issue.url },
      evidenceMode: "replace",
      sourceRole: LINEAR_SOURCE_ROLE,
      linkedEvent: { sourceRawEventId: firstRawEventId, occurredAt: firstObservedAt },
      // A link can persist without its `issue_linked` event ever having landed
      // (a run interrupted between the two writes of an older version).
      repairLinkedEvent: true,
    };
    output.links.push(fact);
  }

  return output;
}
