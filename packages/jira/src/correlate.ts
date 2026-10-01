import type { PrismaClient } from "@sla/db";
import type { CaseRefResolver, CorrelationOutput, LinkFact, LinkSweep } from "@sla/ingestion";
import type { JiraRemoteLink } from "./types";
import { JIRA_SOURCE_ROLE } from "./source-role";

interface LatestRemoteLink {
  link: JiraRemoteLink;
  latestObservedAt: Date;
  /** RawEvent id of the current latest snapshot — the right `sourceRawEventId` for an event that reflects *this* observation (e.g. a re-link), as opposed to the original one. */
  latestRawEventId: string;
  /** Earliest time this link was ever observed — the best available proxy for when it was created, since Jira's remote-link API carries no creation timestamp. */
  firstObservedAt: Date;
  firstRawEventId: string;
}

/** `remote_link:{issueKey}:{linkId}:{hash}` — groups by (issueKey, linkId), keeping the latest snapshot and the earliest-ever observation. */
function latestRemoteLinksByKey(
  rows: { id: string; providerEventId: string; payload: unknown; fetchedAt: Date }[],
): Map<string, { issueKey: string } & LatestRemoteLink> {
  const byKey = new Map<string, { issueKey: string } & LatestRemoteLink>();
  for (const row of rows) {
    const parts = row.providerEventId.split(":");
    const issueKey = parts[1];
    const linkId = parts[2];
    if (!issueKey || !linkId) continue;
    const key = `${issueKey}:${linkId}`;
    const link = row.payload as JiraRemoteLink;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        issueKey,
        link,
        latestObservedAt: row.fetchedAt,
        latestRawEventId: row.id,
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
      existing.latestRawEventId = row.id;
      existing.link = link;
    }
  }
  return byKey;
}

interface RemoteLinkManifestSnapshot {
  rawEventId: string;
  fetchedAt: Date;
  activeLinkIds: Set<number>;
}

/**
 * The latest `remote_link_manifest:{issueKey}:` RawEvent for each issue key
 * present in this integration (or just the one issue, when `issueKeyFilter`
 * narrows the underlying query) — mirrors `latestJiraLinkManifest`
 * (packages/zendesk/src/correlate.ts), just one manifest per issue instead
 * of one for the whole account, since Jira remote links are fetched
 * per-issue rather than as a single global registry (see
 * `mapRemoteLinkManifestToRawEvent`'s doc comment). An issue with no entry
 * in the returned map never had a manifest written for it (a caller seeding
 * `remote_link:` RawEvents directly, e.g. a targeted test, or a row ingested
 * before this manifest existed).
 */
async function latestRemoteLinkManifests(
  prisma: PrismaClient,
  integrationId: string,
  issueKeyFilter?: string,
): Promise<Map<string, RemoteLinkManifestSnapshot>> {
  const rows = await prisma.rawEvent.findMany({
    where: {
      integrationId,
      providerEventId: {
        startsWith: issueKeyFilter ? `remote_link_manifest:${issueKeyFilter}:` : "remote_link_manifest:",
      },
    },
    select: { id: true, providerEventId: true, payload: true, fetchedAt: true },
    orderBy: { fetchedAt: "desc" },
  });

  const byIssueKey = new Map<string, RemoteLinkManifestSnapshot>();
  for (const row of rows) {
    const issueKey = row.providerEventId.split(":")[1];
    if (!issueKey || byIssueKey.has(issueKey)) continue; // rows are fetchedAt-desc, so the first one seen per issue is the latest
    byIssueKey.set(issueKey, {
      rawEventId: row.id,
      fetchedAt: row.fetchedAt,
      activeLinkIds: new Set((row.payload as { linkIds?: number[] }).linkIds ?? []),
    });
  }
  return byIssueKey;
}

/**
 * Deterministic-tier correlator (Phase 15): reads Jira remote links already
 * ingested by the backfill/poll, and for each one whose URL the caller's
 * `resolveCaseRef` recognizes as a ticket of one of this organization's own
 * connected ticket sources, establishes a `certain`/`remote_link` link
 * (`LinkFact`) with an `issue_linked` event on first sight. No fuzzy matching —
 * a link that no ticket source recognizes, or whose ticket has no matching
 * Case yet, is left unlinked and counted, never guessed at. Which hosts and
 * URL shapes count is each ticket-source adapter's business (N1.13); the
 * recognizers stay strict, e.g. a stale Zendesk subdomain is rejected like any
 * other non-matching host. Zendesk's own official Jira-links API
 * (`correlateZendeskJiraLinks`, packages/zendesk/src/correlate.ts) is the
 * authoritative fallback for a relationship a stale remote link can no longer
 * prove.
 *
 * Link identity is `(caseId, system, externalId)` (no `method` in the unique
 * key — see the `CaseLink` model), so when both this producer and Zendesk's
 * discover the same (case, issue) relationship they upsert the very same row:
 * each merges onto the other's evidence under its own key (`remoteLink` here,
 * `officialLink` there), and `official_link` always wins `method`, whichever
 * producer runs first. The shared projector applies those rules.
 *
 * Unlink lifecycle (roadmap task 2.6): a Jira remote-link removal has no
 * deletion event of its own — the only signal is a link's absence from a
 * fresh full per-issue listing (`remote_link_manifest:`, written by
 * `backfillRemoteLinksForIssue` and `runJiraWebhookIngest` alike). So:
 *  1. A link id missing from its issue's *latest* manifest is not reported as
 *     a link, even though its RawEvents are still readable (append-only),
 *     otherwise its own stale history would "reconfirm" it every run, for the
 *     sweep to immediately undo. An issue with no manifest at all treats every
 *     latest snapshot as active.
 *  2. The returned `LinkSweep` marks active remote-link links whose id is
 *     missing from their issue's manifest as unlinked — unless an
 *     `official_link` still independently evidences the same relationship.
 *     Account-wide, so only returned from an unscoped call (the worker's
 *     full-account cycle), never from a per-issue webhook one.
 *
 * Must be projected before `buildJiraBatch`, which relies on the links created
 * here to know which Case a Jira issue's events belong to.
 */
export interface JiraCorrelationScope {
  /**
   * Limits the run to one issue's own remote links — used by the webhook
   * receiver so a single issue update doesn't re-evaluate every remote link
   * the integration has ever seen (roadmap task 2.4). Omit for the worker's
   * full-account cycle, which must still see every issue — including the
   * manifest-diff sweep (task 2.6), which is inherently account-wide and
   * never scoped this way.
   */
  issueKey?: string;
}

export async function correlateJira(
  prisma: PrismaClient,
  integrationId: string,
  resolveCaseRef: CaseRefResolver | null,
  scope: JiraCorrelationScope = {},
): Promise<CorrelationOutput> {
  const output: CorrelationOutput = { links: [], sweeps: [], evaluated: 0, unmatched: {} };
  const unmatch = (reason: string) => (output.unmatched[reason] = (output.unmatched[reason] ?? 0) + 1);

  // No connected ticket source (the caller builds the resolver from the
  // organization's ticket-source integrations): nothing to correlate onto.
  if (!resolveCaseRef) return output;

  const [remoteLinkRows, manifests] = await Promise.all([
    prisma.rawEvent.findMany({
      where: {
        integrationId,
        providerEventId: { startsWith: scope.issueKey ? `remote_link:${scope.issueKey}:` : "remote_link:" },
      },
      select: { id: true, providerEventId: true, payload: true, fetchedAt: true },
    }),
    latestRemoteLinkManifests(prisma, integrationId, scope.issueKey),
  ]);

  const latestLinks = latestRemoteLinksByKey(remoteLinkRows);
  output.evaluated = latestLinks.size;

  const currentlyActive = [...latestLinks.values()].filter(({ issueKey, link }) => {
    const manifest = manifests.get(issueKey);
    return !manifest || manifest.activeLinkIds.has(link.id);
  });

  for (const { issueKey, link, firstRawEventId, firstObservedAt, latestRawEventId, latestObservedAt } of currentlyActive) {
    const ref = await resolveCaseRef(link.object.url);
    if (ref.kind === "unrecognized") {
      unmatch("unrecognizedUrl");
      continue;
    }
    if (ref.kind === "no_case") {
      unmatch("noCase");
      continue;
    }

    const fact: LinkFact = {
      caseId: ref.caseId,
      system: "jira",
      externalId: issueKey,
      method: "remote_link",
      methodOnUpdate: "remote_link",
      evidence: { remoteLink: link },
      evidenceMode: "merge",
      sourceRole: JIRA_SOURCE_ROLE,
      linkedEvent: { sourceRawEventId: firstRawEventId, occurredAt: firstObservedAt },
      // A re-link is a fresh event at the moment this run reconfirmed it.
      relinkedEvent: { sourceRawEventId: latestRawEventId, occurredAt: latestObservedAt },
      repairLinkedEvent: false,
    };
    output.links.push(fact);
  }

  // Account-wide by nature (has to see every issue's manifest) — only from an
  // unscoped (worker) call, never a per-issue webhook one.
  if (!scope.issueKey) {
    const sweep: LinkSweep = {
      system: "jira",
      evidenceKey: "remoteLink",
      otherEvidenceKey: "officialLink",
      sourceRole: JIRA_SOURCE_ROLE,
      manifestFor: (externalId) => manifests.get(externalId) ?? null,
    };
    output.sweeps.push(sweep);
  }

  return output;
}
