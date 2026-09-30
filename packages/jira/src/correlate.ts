import type { Prisma, PrismaClient } from "@sla/db";
import type { JiraRemoteLink } from "./types";
import { JIRA_SOURCE_ROLE } from "./source-role";

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

export interface CorrelationResult {
  remoteLinksEvaluated: number;
  caseLinksCreated: number;
  /** A CaseLink that was `unlinkedAt`-marked (e.g. by either sweep below, or `runZendeskJiraLinkCorrelation`'s) and became active again this run because a remote link still/again evidences it. Not counted in `caseLinksCreated`. */
  caseLinksReactivated: number;
  /** A previously-active remote-link CaseLink whose link id no longer appears in its issue's current manifest (and has no independent `official_link` evidence), marked `unlinkedAt` this run — see `sweepUnlinkedRemoteLinks`. */
  caseLinksUnlinked: number;
  /** Remote links whose URL no connected ticket source recognizes as its own. */
  unmatchedUnrecognizedUrl: number;
  unmatchedNoCase: number;
}

/**
 * A CaseLink's `evidence` as a small bag of merged fields rather than one
 * source's raw payload — `runJiraNormalization` (./normalize.ts) already
 * treats it this way, spreading the existing value and grafting on
 * `statusName`. This producer and its Zendesk-side counterpart
 * (`runZendeskJiraLinkCorrelation` in packages/zendesk/src/correlate.ts)
 * extend that same pattern: each nests its own raw evidence under its own
 * key instead of overwriting the whole field, so a CaseLink discovered by
 * both a remote link and an official link keeps both, never just whichever
 * producer ran last.
 */
interface CaseLinkEvidence {
  remoteLink?: JiraRemoteLink;
  officialLink?: unknown;
  /** Set by `runZendeskJiraLinkCorrelation`'s own sweep (packages/zendesk/src/correlate.ts) the moment it detects `officialLink` above is gone — see that file's doc comment on why this currency marker exists. */
  officialLinkRemovedAt?: string;
  /** The mirror image, set by this file's own `sweepUnlinkedRemoteLinks` below. */
  remoteLinkRemovedAt?: string;
  [key: string]: unknown;
}

/**
 * Deterministic-tier correlator (Phase 15): reads Jira remote links already
 * ingested by the backfill/poll, and for each one whose URL the caller's
 * `resolveCaseRef` recognizes as a ticket of one of this organization's own
 * connected ticket sources, creates a `certain`/`remote_link` CaseLink plus
 * an `issue_linked` NormalizedEvent on first sight. No fuzzy matching — a
 * link that no ticket source recognizes, or whose ticket has no matching
 * Case yet, is left unlinked and counted, never guessed at. Which hosts and
 * URL shapes count is each ticket-source adapter's business (N1.13: this
 * package no longer knows any of them); the recognizers stay strict, e.g. a
 * stale Zendesk subdomain (an old connection's hostname baked into the link)
 * is rejected like any other non-matching host. Zendesk's own official
 * Jira-links API (`runZendeskJiraLinkCorrelation`,
 * packages/zendesk/src/correlate.ts) is the authoritative fallback for a
 * relationship a stale remote link can no longer prove.
 *
 * CaseLink identity is `(caseId, system, externalId)` (no `method` in the
 * unique key — see the `CaseLink` model), so when both this producer and
 * `runZendeskJiraLinkCorrelation` discover the same (case, issue)
 * relationship they upsert the very same row rather than minting two: each
 * merges onto the other's evidence (see `CaseLinkEvidence`), and
 * `official_link` always wins the `method` field once present — it's the
 * authoritative signal — regardless of which producer runs first.
 *
 * Unlink lifecycle (roadmap task 2.6): a Jira remote-link removal has no
 * deletion event of its own — the only signal is a link's absence from a
 * fresh full per-issue listing (`remote_link_manifest:`, written by
 * `backfillRemoteLinksForIssue` and `runJiraWebhookIngest` alike). This
 * function therefore does two passes, mirroring `runZendeskJiraLinkCorrelation`
 * (packages/zendesk/src/correlate.ts — see its doc comment for the full
 * reasoning, including why a manifest-less issue falls back to "every latest
 * snapshot is active"):
 *  1. Filter `latestRemoteLinksByKey`'s results to link ids each issue's
 *     *latest* manifest actually reports, then upsert as before.
 *  2. Sweep every currently-active remote-link CaseLink for this
 *     organization whose link id is missing from its issue's manifest and
 *     mark it `unlinkedAt` — unless an `official_link` still independently
 *     evidences the same relationship. Account-wide and only ever run
 *     unscoped (the worker's full-account cycle) — never from a per-issue
 *     webhook call, since it has to see every issue's manifest to sweep
 *     correctly.
 *
 * Must run before `runJiraNormalization`, which relies on the CaseLinks
 * created here to know which Case a Jira issue's events belong to.
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

export async function runJiraCorrelation(
  prisma: PrismaClient,
  integrationId: string,
  resolveCaseRef: CaseRefResolver | null,
  scope: JiraCorrelationScope = {},
): Promise<CorrelationResult> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const organizationId = integration.organizationId;

  const result: CorrelationResult = {
    remoteLinksEvaluated: 0,
    caseLinksCreated: 0,
    caseLinksReactivated: 0,
    caseLinksUnlinked: 0,
    unmatchedUnrecognizedUrl: 0,
    unmatchedNoCase: 0,
  };

  // No connected ticket source (the caller builds the resolver from the
  // organization's ticket-source integrations): nothing to correlate onto.
  if (!resolveCaseRef) return result;

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
  result.remoteLinksEvaluated = latestLinks.size;

  // A link id missing from its issue's latest manifest is skipped here even
  // though its RawEvents are still readable (append-only) — otherwise its
  // own stale history would "reconfirm" it every run, for the sweep below to
  // immediately undo. An issue with no manifest at all falls back to
  // treating every latest snapshot as active (see this function's doc
  // comment).
  const currentlyActive = [...latestLinks.values()].filter(({ issueKey, link }) => {
    const manifest = manifests.get(issueKey);
    return !manifest || manifest.activeLinkIds.has(link.id);
  });

  for (const { issueKey, link, firstRawEventId, firstObservedAt, latestRawEventId, latestObservedAt } of currentlyActive) {
    const ref = await resolveCaseRef(link.object.url);
    if (ref.kind === "unrecognized") {
      result.unmatchedUnrecognizedUrl += 1;
      continue;
    }
    if (ref.kind === "no_case") {
      result.unmatchedNoCase += 1;
      continue;
    }
    const caseId = ref.caseId;

    const where = { caseId_system_externalId: { caseId: caseId, system: "jira" as const, externalId: issueKey } };
    const existing = await prisma.caseLink.findUnique({ where });
    // Merge onto whatever evidence is already there rather than overwrite —
    // see the `CaseLinkEvidence` doc comment above for why. `official_link`
    // always wins `method` when present, whether it was already recorded
    // here or `runZendeskJiraLinkCorrelation` gets to this same row first.
    const existingEvidence = (existing?.evidence as CaseLinkEvidence | null) ?? {};
    const evidence: CaseLinkEvidence = { ...existingEvidence, remoteLink: link };
    const method: "official_link" | "remote_link" = evidence.officialLink != null ? "official_link" : "remote_link";
    const wasUnlinked = existing != null && existing.unlinkedAt != null;

    // CaseLink upsert and its `issue_linked` event are written atomically so
    // the two can never land only one of them — a crash in between would
    // otherwise leave a CaseLink with no event, indistinguishable from one
    // this correlator just hasn't reached yet. Reaching this upsert at all
    // means a remote link currently resolves to this (case, issue) pair, so
    // `unlinkedAt` always clears here — including reactivating a row
    // `runZendeskJiraLinkCorrelation`'s unlink sweep had marked (the
    // official link disappeared with no remote link at the time; one has
    // since appeared).
    await prisma.$transaction([
      prisma.caseLink.upsert({
        where,
        update: { method, evidence: evidence as Prisma.InputJsonValue, unlinkedAt: null },
        create: {
          caseId: caseId,
          system: "jira",
          externalId: issueKey,
          method,
          confidence: "certain",
          evidence: evidence as Prisma.InputJsonValue,
          confirmedAt: new Date(),
        },
      }),
      ...(!existing
        ? [
            prisma.normalizedEvent.create({
              data: {
                caseId: caseId,
                sourceRawEventId: firstRawEventId,
                type: "issue_linked" as const,
                occurredAt: firstObservedAt,
                actor: "system" as const,
                system: "jira" as const,
                sourceRole: JIRA_SOURCE_ROLE,
                fromState: null,
                toState: null,
              },
            }),
          ]
        : wasUnlinked
          ? [
              // Re-link: a fresh `issue_linked` event at the moment this run
              // reconfirmed it, not the original link time.
              prisma.normalizedEvent.create({
                data: {
                  caseId: caseId,
                  sourceRawEventId: latestRawEventId,
                  type: "issue_linked" as const,
                  occurredAt: latestObservedAt,
                  actor: "system" as const,
                  system: "jira" as const,
                  sourceRole: JIRA_SOURCE_ROLE,
                  fromState: null,
                  toState: null,
                },
              }),
            ]
          : []),
    ]);

    if (!existing) {
      result.caseLinksCreated += 1;
    } else if (wasUnlinked) {
      result.caseLinksReactivated += 1;
    }
  }

  // Account-wide by nature (has to see every issue's manifest) — only run
  // from an unscoped (worker) call, never a per-issue webhook one.
  if (!scope.issueKey) {
    await sweepUnlinkedRemoteLinks(prisma, organizationId, manifests, result);
  }

  return result;
}

/**
 * Detects a Jira remote-link removal: a currently-active, remote-link-
 * evidenced CaseLink whose link id is missing from its issue's latest
 * `remote_link_manifest:` listing.
 *
 * An `official_link` still present in the same CaseLink's evidence exempts
 * it from actually unlinking — one evidence source disappearing must never
 * delete a relationship another source still proves — **unless** that
 * official link was itself already marked removed by
 * `runZendeskJiraLinkCorrelation`'s own sweep (`evidence.officialLinkRemovedAt`).
 * Mirrors `sweepUnlinkedOfficialLinks` (packages/zendesk/src/correlate.ts) —
 * see its doc comment for the full reasoning behind this second check: without
 * it, a CaseLink whose official link and remote link are both eventually
 * removed — just not in the same run — would stay linked forever. An
 * exempted-but-since-removed remote link stamps `evidence.remoteLinkRemovedAt`
 * so a later official-link removal sees it and finishes the unlink.
 *
 * `caseLink.externalId` is the issue key (CaseLink identity is
 * `(caseId, system, externalId)`), so it doubles as the lookup key into
 * `manifests` here.
 */
async function sweepUnlinkedRemoteLinks(
  prisma: PrismaClient,
  organizationId: string,
  manifests: Map<string, RemoteLinkManifestSnapshot>,
  result: CorrelationResult,
): Promise<void> {
  const activeJiraLinks = await prisma.caseLink.findMany({
    where: { system: "jira", unlinkedAt: null, case: { organizationId } },
    select: { id: true, caseId: true, externalId: true, evidence: true },
  });

  for (const caseLink of activeJiraLinks) {
    const evidence = caseLink.evidence as CaseLinkEvidence | null;
    const remoteLinkId = evidence?.remoteLink?.id;
    if (remoteLinkId == null) continue; // never had remote-link evidence — nothing for this sweep to say
    const manifest = manifests.get(caseLink.externalId);
    if (!manifest) continue; // no manifest for this issue — nothing to diff against
    if (manifest.activeLinkIds.has(remoteLinkId)) continue; // still current

    const officialLinkStillProvesIt = evidence?.officialLink != null && evidence?.officialLinkRemovedAt == null;
    if (officialLinkStillProvesIt) {
      if (evidence?.remoteLinkRemovedAt == null) {
        await prisma.caseLink.update({
          where: { id: caseLink.id },
          data: { evidence: { ...evidence, remoteLinkRemovedAt: manifest.fetchedAt.toISOString() } as unknown as Prisma.InputJsonValue },
        });
      }
      continue;
    }

    await prisma.$transaction([
      prisma.caseLink.update({
        where: { id: caseLink.id },
        data: {
          unlinkedAt: manifest.fetchedAt,
          evidence: { ...evidence, remoteLinkRemovedAt: manifest.fetchedAt.toISOString() } as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.normalizedEvent.create({
        data: {
          caseId: caseLink.caseId,
          sourceRawEventId: manifest.rawEventId,
          type: "issue_unlinked" as const,
          occurredAt: manifest.fetchedAt,
          actor: "system" as const,
          system: "jira" as const,
          sourceRole: JIRA_SOURCE_ROLE,
          fromState: null,
          toState: null,
        },
      }),
    ]);
    result.caseLinksUnlinked += 1;
  }
}
