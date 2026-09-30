import type { Prisma, PrismaClient } from "@sla/db";
import type { LinearAttachment, LinearIssue } from "./types";
import { LINEAR_SOURCE_ROLE } from "./source-role";

/**
 * What an external URL points at, decided by the caller (N1.13): this package
 * knows nothing about ticket sources. Structurally the same as
 * `CaseRefResolver` in `@sla/commitments`, which builds it.
 */
export type CaseRefResolution =
  | { kind: "case"; caseId: string }
  | { kind: "unrecognized" }
  | { kind: "no_case" };
export type CaseRefResolver = (url: string) => Promise<CaseRefResolution>;

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

export interface CorrelationResult {
  attachmentsEvaluated: number;
  caseLinksCreated: number;
  /** Attachments whose URL no connected ticket source recognizes as its own. */
  unmatchedUnrecognizedUrl: number;
  unmatchedNoCase: number;
  /** An attachment observed before its issue's own snapshot was ingested — the backfill always writes the issue first, so this should stay at zero in practice; counted rather than assumed impossible. */
  unmatchedNoIssueSnapshot: number;
}

/**
 * Deterministic-tier correlator (Phase 15), mirroring `runJiraCorrelation`:
 * reads Linear attachments already ingested by the backfill/poll, and for
 * each one whose URL the caller's `resolveCaseRef` recognizes as a ticket of
 * one of this organization's own connected ticket sources, creates a
 * `certain`/`remote_link` CaseLink plus an `issue_linked` NormalizedEvent on
 * first sight. No fuzzy matching — an attachment no ticket source
 * recognizes, or whose ticket has no matching Case yet, is left unlinked
 * and counted, never guessed at. Which hosts and URL shapes count is each
 * ticket-source adapter's business (N1.13).
 *
 * Must run before `runLinearNormalization`, which relies on the CaseLinks
 * created here to know which Case a Linear issue's events belong to.
 *
 * The CaseLink's `evidence` stores the linked issue's own `url` alongside
 * the attachment, because — unlike Jira (`siteUrl`) or Zendesk
 * (`subdomain`) — Linear's stored OAuth credentials carry no workspace URL
 * to reconstruct a browse link from later, so the URL is captured here at
 * correlation time instead.
 */
export async function runLinearCorrelation(
  prisma: PrismaClient,
  integrationId: string,
  resolveCaseRef: CaseRefResolver | null,
): Promise<CorrelationResult> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const organizationId = integration.organizationId;

  const result: CorrelationResult = {
    attachmentsEvaluated: 0,
    caseLinksCreated: 0,
    unmatchedUnrecognizedUrl: 0,
    unmatchedNoCase: 0,
    unmatchedNoIssueSnapshot: 0,
  };

  // No connected ticket source (the caller builds the resolver from the
  // organization's ticket-source integrations): nothing to correlate onto.
  if (!resolveCaseRef) return result;

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
  result.attachmentsEvaluated = latestAttachments.size;

  for (const { issueId, attachment, firstRawEventId, firstObservedAt } of latestAttachments.values()) {
    const ref = await resolveCaseRef(attachment.url);
    if (ref.kind === "unrecognized") {
      result.unmatchedUnrecognizedUrl += 1;
      continue;
    }

    const issue = issuesById.get(issueId);
    if (!issue) {
      result.unmatchedNoIssueSnapshot += 1;
      continue;
    }

    if (ref.kind === "no_case") {
      result.unmatchedNoCase += 1;
      continue;
    }
    const caseId = ref.caseId;

    const where = {
      caseId_system_externalId: { caseId, system: "linear" as const, externalId: issue.identifier },
    };
    const existing = await prisma.caseLink.findUnique({ where });
    const evidence = { attachment, issueUrl: issue.url } as unknown as Prisma.InputJsonValue;

    await prisma.caseLink.upsert({
      where,
      update: { evidence },
      create: {
        caseId,
        system: "linear",
        externalId: issue.identifier,
        method: "remote_link",
        confidence: "certain",
        evidence,
        confirmedAt: new Date(),
      },
    });

    if (!existing) {
      result.caseLinksCreated += 1;
    }

    // Checked independently of `existing`: a CaseLink can persist without
    // its `issue_linked` event ever having landed (e.g. a prior run created
    // the link but was interrupted before emitting the event), and gating
    // solely on the link's own existence would leave that drift permanent.
    const existingLinkEvent = await prisma.normalizedEvent.findFirst({
      where: { caseId, type: "issue_linked", sourceRawEventId: firstRawEventId },
      select: { id: true },
    });

    if (!existingLinkEvent) {
      await prisma.normalizedEvent.create({
        data: {
          caseId,
          sourceRawEventId: firstRawEventId,
          type: "issue_linked",
          occurredAt: firstObservedAt,
          actor: "system",
          system: "linear",
          sourceRole: LINEAR_SOURCE_ROLE,
          fromState: null,
          toState: null,
        },
      });
    }
  }

  return result;
}
