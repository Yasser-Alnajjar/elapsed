import type { Prisma, PrismaClient } from "@sla/db";
import type { GithubPullRequest } from "./types";
import { GITHUB_SOURCE_ROLE } from "./source-role";

/**
 * A Jira issue key / Linear identifier shape: an uppercase team/project key
 * followed by a dash and a number (e.g. "ENG-456", "PROJ-123"). Both
 * providers use this exact shape as their own CaseLink.externalId (Jira: the
 * issue key; Linear: `issue.identifier`) — see
 * packages/jira/src/correlate.ts and packages/linear/src/correlate.ts.
 */
const ISSUE_IDENTIFIER_PATTERN = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

/**
 * Extracts every candidate Jira/Linear issue identifier from freeform text.
 * Text is uppercased before matching — branch names are commonly lowercase
 * (Linear's own auto-branch-naming convention is e.g.
 * "username/eng-456-title"), but the canonical identifier form stored as
 * CaseLink.externalId is always uppercase for both providers.
 */
export function extractIssueIdentifiers(text: string): string[] {
  const matches = text.toUpperCase().match(ISSUE_IDENTIFIER_PATTERN) ?? [];
  return [...new Set(matches)];
}

interface LatestPullRequest {
  pr: GithubPullRequest;
  rawEventId: string;
  observedAt: Date;
}

/** Latest snapshot per PR node id, from `pull_request:{owner}/{repo}#{number}:{hash}` RawEvents. */
function latestPullRequestsById(
  rows: { id: string; payload: unknown; fetchedAt: Date }[],
): Map<string, LatestPullRequest> {
  const byId = new Map<string, LatestPullRequest>();
  for (const row of rows) {
    const pr = row.payload as GithubPullRequest;
    const existing = byId.get(pr.id);
    if (!existing || row.fetchedAt >= existing.observedAt) {
      byId.set(pr.id, { pr, rawEventId: row.id, observedAt: row.fetchedAt });
    }
  }
  return byId;
}

export interface CorrelationResult {
  pullRequestsEvaluated: number;
  caseLinksCreated: number;
  unmatchedNoIdentifier: number;
  unmatchedNoCaseLink: number;
}

/**
 * Deterministic-tier correlator, but transitively rather than through a
 * Zendesk-shaped link object the way Jira's remote links / Linear's
 * attachments work — GitHub has no first-party equivalent. Instead: extract
 * a Jira/Linear-shaped issue identifier from the PR's title or branch name,
 * and if that identifier is already linked (a `certain` CaseLink) to a Case
 * via Jira or Linear, mint a matching `github` CaseLink on the same Case.
 * Needs no knowledge of Zendesk at all — correlation piggybacks entirely on
 * work Jira's/Linear's own correlator already did.
 *
 * A PR can reference more than one issue identifier (e.g. "Fixes ENG-1 and
 * PROJ-2") and, if those resolve to different Cases, links to both — not
 * ambiguous, just multiple genuine references. No fuzzy matching: an
 * identifier that doesn't match anything, or a PR with no identifier in its
 * title/branch at all, is left unlinked and counted, never guessed at.
 *
 * Must run before `runGithubNormalization`. Depends on Jira's/Linear's own
 * correlator having already run for this organization — if it hasn't yet
 * this cycle, matches are simply deferred to the next poll (upsert-based,
 * self-healing, same as Jira/Linear).
 */
export async function runGithubCorrelation(prisma: PrismaClient, integrationId: string): Promise<CorrelationResult> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const organizationId = integration.organizationId;
  const { owner, repo } = integration.credentials as unknown as { owner: string; repo: string };

  const result: CorrelationResult = {
    pullRequestsEvaluated: 0,
    caseLinksCreated: 0,
    unmatchedNoIdentifier: 0,
    unmatchedNoCaseLink: 0,
  };

  const pullRequestRows = await prisma.rawEvent.findMany({
    where: { integrationId, providerEventId: { startsWith: "pull_request:" } },
    select: { id: true, payload: true, fetchedAt: true },
  });

  const latestPullRequests = latestPullRequestsById(pullRequestRows);
  result.pullRequestsEvaluated = latestPullRequests.size;

  for (const { pr, rawEventId, observedAt } of latestPullRequests.values()) {
    const identifiers = new Set([...extractIssueIdentifiers(pr.title), ...extractIssueIdentifiers(pr.headRefName)]);
    if (identifiers.size === 0) {
      result.unmatchedNoIdentifier += 1;
      continue;
    }

    const matchedLinks = await prisma.caseLink.findMany({
      where: {
        externalId: { in: [...identifiers] },
        system: { in: ["jira", "linear"] },
        confidence: "certain",
        case: { organizationId },
      },
      select: { caseId: true },
    });

    if (matchedLinks.length === 0) {
      result.unmatchedNoCaseLink += 1;
      continue;
    }

    const externalId = `${owner}/${repo}#${pr.number}`;
    const distinctCaseIds = [...new Set(matchedLinks.map((link) => link.caseId))];

    for (const caseId of distinctCaseIds) {
      const where = { caseId_system_externalId: { caseId, system: "github" as const, externalId } };
      const existing = await prisma.caseLink.findUnique({ where });
      const evidence = {
        title: pr.title,
        headRefName: pr.headRefName,
        matchedIdentifiers: [...identifiers],
      } as unknown as Prisma.InputJsonValue;

      await prisma.caseLink.upsert({
        where,
        update: { evidence },
        create: {
          caseId,
          system: "github",
          externalId,
          method: "pattern",
          confidence: "certain",
          evidence,
          confirmedAt: new Date(),
        },
      });

      if (!existing) {
        result.caseLinksCreated += 1;
      }

      // Checked independently of `existing`: a CaseLink can persist without
      // its `issue_linked` event ever having landed (e.g. a prior run
      // created the link but was interrupted before emitting the event),
      // and gating solely on the link's own existence would leave that
      // drift permanent.
      const existingLinkEvent = await prisma.normalizedEvent.findFirst({
        where: { caseId, type: "issue_linked", sourceRawEventId: rawEventId },
        select: { id: true },
      });

      if (!existingLinkEvent) {
        await prisma.normalizedEvent.create({
          data: {
            caseId,
            sourceRawEventId: rawEventId,
            type: "issue_linked",
            occurredAt: observedAt,
            actor: "system",
            system: "github",
            sourceRole: GITHUB_SOURCE_ROLE,
            fromState: null,
            toState: null,
          },
        });
      }
    }
  }

  return result;
}
