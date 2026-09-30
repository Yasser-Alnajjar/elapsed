import type { Prisma, PrismaClient } from "@sla/db";
import type { ZendeskJiraLink } from "./types";
import { JIRA_LINK_EVENT_SOURCE_ROLE } from "./source-role";

/**
 * Validates a Zendesk official Jira-link record's structured ids. Unlike
 * `parseZendeskTicketId` (packages/jira/src/correlate.ts), there's no URL to
 * parse and no hostname to validate — Zendesk hands back `ticket_id`/
 * `issue_key` directly — so this only guards against a malformed or
 * incomplete record ("do not parse a URL to derive the relationship when
 * ticket_id and issue_key are already available from the API").
 *
 * `ticket_id` arrives as a **string** in the live API response (confirmed
 * against a real connected account — the field name suggests a number, but
 * the JSON value is `"13"`, not `13`). A prior version of this function
 * required `typeof === "number"` here, which silently rejected every real
 * record as malformed and is why official-link correlation produced zero
 * CaseLinks in production despite valid data being ingested. Also accepts an
 * actual number defensively, in case Zendesk's response ever changes.
 * `Case.externalId` is itself a decimal string (`String(ticket.id)` — see
 * `runZendeskNormalization`), so a numeric-looking string here needs no
 * further conversion to match it.
 */
export function parseJiraLinkRecord(link: ZendeskJiraLink): { ticketId: string; issueKey: string } | null {
  const ticketId =
    typeof link.ticket_id === "string"
      ? link.ticket_id.trim()
      : typeof link.ticket_id === "number" && Number.isFinite(link.ticket_id)
        ? String(link.ticket_id)
        : null;
  if (!ticketId || !/^\d+$/.test(ticketId)) return null;
  if (typeof link.issue_key !== "string" || link.issue_key.trim() === "") return null;
  return { ticketId, issueKey: link.issue_key };
}

interface LatestJiraLink {
  link: ZendeskJiraLink;
  latestObservedAt: Date;
  /** RawEvent id of the current latest snapshot — the right `sourceRawEventId` for an event that reflects *this* observation (e.g. a re-link), as opposed to the original one. */
  latestRawEventId: string;
  /** Earliest time this link was ever observed — the best available proxy for when it was created, mirroring `latestRemoteLinksByKey` in packages/jira/src/correlate.ts. */
  firstObservedAt: Date;
  firstRawEventId: string;
}

/** `jira_link:{id}:{hash}` — groups by the Zendesk link's own id, keeping the latest snapshot and the earliest-ever observation. */
function latestJiraLinksById(
  rows: { id: string; providerEventId: string; payload: unknown; fetchedAt: Date }[],
): Map<string, LatestJiraLink> {
  const byId = new Map<string, LatestJiraLink>();
  for (const row of rows) {
    const linkId = row.providerEventId.split(":")[1];
    if (!linkId) continue;
    const link = row.payload as ZendeskJiraLink;

    const existing = byId.get(linkId);
    if (!existing) {
      byId.set(linkId, {
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
  return byId;
}

export interface JiraLinkCorrelationResult {
  officialLinksEvaluated: number;
  caseLinksCreated: number;
  /** A CaseLink that was `unlinkedAt`-marked and became active again this run (same row — see `CaseLink.unlinkedAt`'s doc comment). Not counted in `caseLinksCreated`. */
  caseLinksReactivated: number;
  /** A previously-active official-link CaseLink whose link id no longer appears in Zendesk's current registry (and has no independent `remote_link` evidence), marked `unlinkedAt` this run. */
  caseLinksUnlinked: number;
  unmatchedInvalidRecord: number;
  unmatchedNoCase: number;
}

/**
 * A CaseLink's `evidence` as a small bag of merged fields rather than one
 * source's raw payload — `runJiraNormalization` (packages/jira/src/normalize.ts)
 * already treats it this way, spreading the existing value and grafting on
 * `statusName`. Both correlation producers (this one and `runJiraCorrelation`
 * in packages/jira/src/correlate.ts) extend that same pattern: each nests its
 * own raw evidence under its own key instead of overwriting the whole field,
 * so a CaseLink discovered by both an official link and a remote link keeps
 * both, never just whichever producer ran last.
 */
interface CaseLinkEvidence {
  officialLink?: ZendeskJiraLink;
  remoteLink?: unknown;
  /**
   * Set by `runJiraCorrelation`'s own remote-link sweep (packages/jira/src/
   * correlate.ts, roadmap task 2.6) the moment it detects `remoteLink` above
   * is gone from the issue's current manifest — even while this CaseLink
   * stays active because `officialLink` still proves it. Lets
   * `sweepUnlinkedOfficialLinks` below tell "the other source still proves
   * this" from "the other source was ALSO removed, it just hasn't been
   * swept yet" — without this marker, a CaseLink whose official link and
   * remote link are *both* eventually removed would stay linked forever,
   * since each sweep's `!= null` exemption check alone can never tell the
   * difference (each only ever adds this evidence key, never clears it).
   */
  remoteLinkRemovedAt?: string;
  /** The mirror image, set by this file's own sweep — see `remoteLinkRemovedAt`. */
  officialLinkRemovedAt?: string;
  [key: string]: unknown;
}

/**
 * Deterministic-tier correlator, the Zendesk-side counterpart to
 * `runJiraCorrelation` (packages/jira/src/correlate.ts): reads Zendesk's
 * official Jira-links registry (`GET /api/v2/jira/links`, already ingested by
 * `runZendeskBackfill`) and, for each valid `{ticket_id, issue_key}` pair,
 * creates a `certain`/`official_link` CaseLink plus an `issue_linked`
 * NormalizedEvent on first sight.
 *
 * This is the authoritative structured correlation signal: unlike a Jira
 * remote link, there's no URL to parse and no Zendesk hostname to validate,
 * so it still finds the relationship when a remote link exists but points at
 * a stale Zendesk subdomain (and `parseZendeskTicketId`'s strict hostname
 * check correctly rejects it). Independent of whether the Jira integration
 * is even connected — the ids come entirely from Zendesk's own API.
 *
 * CaseLink identity is `(caseId, system, externalId)` (no `method` in the
 * unique key — see the `CaseLink` model), so when both this producer and
 * `runJiraCorrelation` discover the same (case, issue) relationship they
 * upsert the very same row rather than minting two: each merges onto the
 * other's evidence (see `CaseLinkEvidence`), and `official_link` always wins
 * the `method` field once present, in either write order.
 *
 * Unlink lifecycle: a Zendesk unlink has no deletion event of its own — the
 * only signal is a link's absence from a fresh full listing
 * (`jira_link_manifest:`, written once per backfill by `backfillJiraLinks`).
 * This function therefore does two passes:
 *  1. Upsert every link id the *latest* manifest actually reports (as
 *     before), clearing `unlinkedAt` and emitting a fresh `issue_linked`
 *     event on any row that was previously marked unlinked (a re-link). A
 *     link id the manifest no longer reports is skipped here even though its
 *     RawEvents are still readable (append-only) — otherwise its own stale
 *     history would "reconfirm" it every run, for pass 2 to immediately
 *     undo. With no manifest at all (a caller that seeds `jira_link:`
 *     RawEvents directly without ever writing one, e.g. a targeted test),
 *     every latest snapshot is treated as active — the original,
 *     pre-unlink-tracking behavior.
 *  2. Sweep every currently-active official-link CaseLink for this
 *     organization whose link id is missing from that same manifest and
 *     mark it `unlinkedAt` — unless a `remote_link` still independently
 *     evidences the same relationship (see `CaseLinkEvidence` and
 *     `runJiraCorrelation`'s doc comment: one source disappearing must never
 *     delete a relationship another source still proves). Only runs when a
 *     manifest exists, for the same reason pass 1 falls back above.
 * Neither pass ever deletes the CaseLink row, its `evidence`, or any
 * RawEvent/NormalizedEvent — `unlinkedAt` only marks the relationship
 * inactive, mirroring `Case.deletedAt`/`SLAPolicy.archivedAt`. The engine in
 * packages/core (`deriveLegSpans`) is span-based and already treats
 * `issue_unlinked` as ending the *current* engineering span without
 * rewriting any span that already closed — historical leg/SLA timing is
 * untouched by design, not by any special-casing here.
 *
 * Must run after `runZendeskNormalization`, which is what creates the Cases
 * this correlator looks up by ticket id.
 */
export async function runZendeskJiraLinkCorrelation(
  prisma: PrismaClient,
  integrationId: string,
): Promise<JiraLinkCorrelationResult> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const organizationId = integration.organizationId;

  const result: JiraLinkCorrelationResult = {
    officialLinksEvaluated: 0,
    caseLinksCreated: 0,
    caseLinksReactivated: 0,
    caseLinksUnlinked: 0,
    unmatchedInvalidRecord: 0,
    unmatchedNoCase: 0,
  };

  const manifest = await latestJiraLinkManifest(prisma, integrationId);

  const jiraLinkRows = await prisma.rawEvent.findMany({
    where: { integrationId, providerEventId: { startsWith: "jira_link:" } },
    select: { id: true, providerEventId: true, payload: true, fetchedAt: true },
  });

  const latestLinks = latestJiraLinksById(jiraLinkRows);
  result.officialLinksEvaluated = latestLinks.size;

  // RawEvents are append-only — every link ever seen is still queryable
  // here, unlinked ones included. Without this filter, a link Zendesk no
  // longer reports would still get "reconfirmed" (and, if already marked
  // unlinked, spuriously re-linked) by its own stale history on every run,
  // for the unlink sweep below to immediately undo again. Only when a
  // manifest exists is a link id actually excluded here — with none, every
  // latest snapshot is treated as active, the original (pre-unlink-tracking)
  // behavior, so a caller that never models a manifest (e.g. a test seeding
  // `jira_link:` RawEvents directly) sees no change here at all.
  const currentlyActive =
    manifest == null
      ? latestLinks.values()
      : [...latestLinks.values()].filter(({ link }) => manifest.activeLinkIds.has(link.id));

  for (const { link, firstRawEventId, firstObservedAt, latestRawEventId, latestObservedAt } of currentlyActive) {
    const parsed = parseJiraLinkRecord(link);
    if (!parsed) {
      result.unmatchedInvalidRecord += 1;
      continue;
    }
    const { ticketId, issueKey } = parsed;

    const zendeskCase = await prisma.case.findUnique({
      where: { organizationId_externalId: { organizationId, externalId: ticketId } },
    });
    if (!zendeskCase || zendeskCase.deletedAt) {
      result.unmatchedNoCase += 1;
      continue;
    }

    const where = { caseId_system_externalId: { caseId: zendeskCase.id, system: "jira" as const, externalId: issueKey } };
    const existing = await prisma.caseLink.findUnique({ where });
    const existingEvidence = (existing?.evidence as CaseLinkEvidence | null) ?? {};
    const evidence: CaseLinkEvidence = { ...existingEvidence, officialLink: link };
    const wasUnlinked = existing != null && existing.unlinkedAt != null;

    // CaseLink upsert and its `issue_linked` event are written atomically so
    // the two can never land only one of them — a crash in between would
    // otherwise leave a CaseLink with no event, indistinguishable from one
    // this correlator just hasn't reached yet.
    await prisma.$transaction([
      prisma.caseLink.upsert({
        where,
        update: { method: "official_link", evidence: evidence as Prisma.InputJsonValue, unlinkedAt: null },
        create: {
          caseId: zendeskCase.id,
          system: "jira",
          externalId: issueKey,
          method: "official_link",
          confidence: "certain",
          evidence: evidence as Prisma.InputJsonValue,
          confirmedAt: new Date(),
        },
      }),
      ...(!existing
        ? [
            prisma.normalizedEvent.create({
              data: {
                caseId: zendeskCase.id,
                sourceRawEventId: firstRawEventId,
                type: "issue_linked" as const,
                occurredAt: firstObservedAt,
                actor: "system" as const,
                system: "jira" as const,
                sourceRole: JIRA_LINK_EVENT_SOURCE_ROLE,
                fromState: null,
                toState: null,
              },
            }),
          ]
        : wasUnlinked
          ? [
              // Re-link: a fresh `issue_linked` event at the moment this run
              // reconfirmed it (not the original link time), so
              // `deriveLegSpans` (packages/core) opens a new engineering span
              // here rather than reusing the closed one.
              prisma.normalizedEvent.create({
                data: {
                  caseId: zendeskCase.id,
                  sourceRawEventId: latestRawEventId,
                  type: "issue_linked" as const,
                  occurredAt: latestObservedAt,
                  actor: "system" as const,
                  system: "jira" as const,
                  sourceRole: JIRA_LINK_EVENT_SOURCE_ROLE,
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

  if (manifest) {
    await sweepUnlinkedOfficialLinks(prisma, organizationId, manifest, result);
  }

  return result;
}

interface JiraLinkManifestSnapshot {
  rawEventId: string;
  fetchedAt: Date;
  activeLinkIds: Set<number>;
}

/** The most recent `jira_link_manifest:` RawEvent for this integration, or `null` if one was never written (see the caller's doc comment for why that matters). */
async function latestJiraLinkManifest(prisma: PrismaClient, integrationId: string): Promise<JiraLinkManifestSnapshot | null> {
  const row = await prisma.rawEvent.findFirst({
    where: { integrationId, providerEventId: { startsWith: "jira_link_manifest:" } },
    select: { id: true, payload: true, fetchedAt: true },
    orderBy: { fetchedAt: "desc" },
  });
  if (!row) return null;
  return {
    rawEventId: row.id,
    fetchedAt: row.fetchedAt,
    activeLinkIds: new Set((row.payload as { linkIds?: number[] }).linkIds ?? []),
  };
}

/**
 * Detects a Zendesk unlink: a currently-active, official-link-evidenced
 * CaseLink whose link id is missing from the latest full `jira_link_manifest:`
 * listing.
 *
 * A `remote_link` still present in the same CaseLink's evidence exempts it
 * from actually unlinking — one evidence source disappearing must never
 * delete a relationship another source still proves (see
 * `runJiraCorrelation`'s doc comment) — **unless** that remote link was
 * itself already marked removed by `runJiraCorrelation`'s own sweep
 * (`evidence.remoteLinkRemovedAt`). Without that second check, a CaseLink
 * whose official link and remote link are both eventually removed — just
 * not in the same run — would stay linked forever: each sweep's evidence
 * only ever gains a `*Link` key, never loses it, so a naive `!= null`
 * exemption can't otherwise distinguish "still proven" from "also gone, not
 * yet swept". An exempted-but-since-removed official link stamps
 * `evidence.officialLinkRemovedAt` (not `unlinkedAt`, only this bookkeeping
 * field) so a later remote-link removal sees it and finishes the unlink.
 */
async function sweepUnlinkedOfficialLinks(
  prisma: PrismaClient,
  organizationId: string,
  manifest: JiraLinkManifestSnapshot,
  result: JiraLinkCorrelationResult,
): Promise<void> {
  const activeOfficialLinks = await prisma.caseLink.findMany({
    where: { system: "jira", unlinkedAt: null, case: { organizationId } },
    select: { id: true, caseId: true, evidence: true },
  });

  for (const caseLink of activeOfficialLinks) {
    const evidence = caseLink.evidence as CaseLinkEvidence | null;
    const officialLinkId = evidence?.officialLink?.id;
    if (officialLinkId == null) continue; // never had official-link evidence — nothing for this sweep to say
    if (manifest.activeLinkIds.has(officialLinkId)) continue; // still current

    const remoteLinkStillProvesIt = evidence?.remoteLink != null && evidence?.remoteLinkRemovedAt == null;
    if (remoteLinkStillProvesIt) {
      // Record that the official link is gone, without unlinking — a later
      // remote-link removal (packages/jira's sweep) needs this to finish the
      // job instead of exempting forever on stale `remoteLink != null` evidence.
      if (evidence?.officialLinkRemovedAt == null) {
        await prisma.caseLink.update({
          where: { id: caseLink.id },
          data: { evidence: { ...evidence, officialLinkRemovedAt: manifest.fetchedAt.toISOString() } as Prisma.InputJsonValue },
        });
      }
      continue;
    }

    await prisma.$transaction([
      prisma.caseLink.update({
        where: { id: caseLink.id },
        data: {
          unlinkedAt: manifest.fetchedAt,
          evidence: { ...evidence, officialLinkRemovedAt: manifest.fetchedAt.toISOString() } as Prisma.InputJsonValue,
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
          sourceRole: JIRA_LINK_EVENT_SOURCE_ROLE,
          fromState: null,
          toState: null,
        },
      }),
    ]);
    result.caseLinksUnlinked += 1;
  }
}
