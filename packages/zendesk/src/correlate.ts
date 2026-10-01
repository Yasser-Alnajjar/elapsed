import type { PrismaClient } from "@sla/db";
import type { CorrelationOutput, LinkFact } from "@sla/ingestion";
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
 * ``buildZendeskBatch`'s projection`), so a numeric-looking string here needs no
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

/**
 * Deterministic-tier correlator, the Zendesk-side counterpart to
 * `correlateJira` (packages/jira/src/correlate.ts): reads Zendesk's
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
 * `correlateJira` discover the same (case, issue) relationship they
 * upsert the very same row rather than minting two: each merges onto the
 * other's evidence (under `officialLink` here, `remoteLink` there), and `official_link` always wins
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
 *     evidences the same relationship (see `correlateJira`'s doc comment: one source disappearing must never
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
 * Must be projected after the ticket batch (`buildZendeskBatch`), which is what
 * creates the Cases this correlator looks up by ticket id.
 */
export async function correlateZendeskJiraLinks(prisma: PrismaClient, integrationId: string): Promise<CorrelationOutput> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const organizationId = integration.organizationId;

  const output: CorrelationOutput = { links: [], sweeps: [], evaluated: 0, unmatched: {} };
  const unmatch = (reason: string) => (output.unmatched[reason] = (output.unmatched[reason] ?? 0) + 1);

  const manifest = await latestJiraLinkManifest(prisma, integrationId);

  const jiraLinkRows = await prisma.rawEvent.findMany({
    where: { integrationId, providerEventId: { startsWith: "jira_link:" } },
    select: { id: true, providerEventId: true, payload: true, fetchedAt: true },
  });

  const latestLinks = latestJiraLinksById(jiraLinkRows);
  output.evaluated = latestLinks.size;

  // RawEvents are append-only — every link ever seen is still queryable
  // here, unlinked ones included. Without this filter, a link Zendesk no
  // longer reports would still get "reconfirmed" (and, if already marked
  // unlinked, spuriously re-linked) by its own stale history on every run,
  // for the unlink sweep to immediately undo again. Only when a manifest
  // exists is a link id actually excluded here — with none, every latest
  // snapshot is treated as active, the original (pre-unlink-tracking)
  // behavior, so a caller that never models a manifest (e.g. a test seeding
  // `jira_link:` RawEvents directly) sees no change here at all.
  const currentlyActive =
    manifest == null
      ? latestLinks.values()
      : [...latestLinks.values()].filter(({ link }) => manifest.activeLinkIds.has(link.id));

  for (const { link, firstRawEventId, firstObservedAt, latestRawEventId, latestObservedAt } of currentlyActive) {
    const parsed = parseJiraLinkRecord(link);
    if (!parsed) {
      unmatch("invalidRecord");
      continue;
    }
    const { ticketId, issueKey } = parsed;

    const zendeskCase = await prisma.case.findUnique({
      where: {
        organizationId_sourceIntegrationId_externalId: { organizationId, sourceIntegrationId: integrationId, externalId: ticketId },
      },
      select: { id: true, deletedAt: true },
    });
    if (!zendeskCase || zendeskCase.deletedAt) {
      unmatch("noCase");
      continue;
    }

    const fact: LinkFact = {
      caseId: zendeskCase.id,
      // The relationship is to a Jira issue, though Zendesk is the producer.
      system: "jira",
      externalId: issueKey,
      method: "official_link",
      methodOnUpdate: "official_link",
      evidence: { officialLink: link },
      evidenceMode: "merge",
      sourceRole: JIRA_LINK_EVENT_SOURCE_ROLE,
      linkedEvent: { sourceRawEventId: firstRawEventId, occurredAt: firstObservedAt },
      // A re-link is a fresh event at the moment this run reconfirmed it (not
      // the original link time), so the engine opens a new engineering span.
      relinkedEvent: { sourceRawEventId: latestRawEventId, occurredAt: latestObservedAt },
      repairLinkedEvent: false,
    };
    output.links.push(fact);
  }

  if (manifest) {
    output.sweeps.push({
      system: "jira",
      evidenceKey: "officialLink",
      otherEvidenceKey: "remoteLink",
      sourceRole: JIRA_LINK_EVENT_SOURCE_ROLE,
      // One registry listing covers every link, so the same manifest answers for any issue.
      manifestFor: () => manifest,
    });
  }

  return output;
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
