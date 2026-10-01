import type { SourceRole } from "@sla/core";
import { Prisma, type IntegrationProvider, type PrismaClient } from "@sla/db";
import type { LinkEventSource, LinkFact, LinkSweep } from "./contract";

export interface LinkProjectionResult {
  created: number;
  /** A row marked unlinked that a link evidences again. Not counted in `created`. */
  reactivated: number;
  updated: number;
}

export interface LinkSweepResult {
  /** Links marked `unlinkedAt` this run. */
  unlinked: number;
}

type Json = Prisma.InputJsonValue;

/**
 * Persists the links an integration observed: the one place that creates or
 * updates `CaseLink` rows. Reaching a fact at all means a source currently
 * evidences the relationship, so `unlinkedAt` always clears, reactivating a
 * row a sweep had marked.
 *
 * The `CaseLink` upsert and its `issue_linked` event are written atomically,
 * so a crash between them cannot leave a link with no event. Runs inside the
 * caller's organization lock.
 */
export async function projectLinkFacts(prisma: PrismaClient, facts: readonly LinkFact[]): Promise<LinkProjectionResult> {
  const result: LinkProjectionResult = { created: 0, reactivated: 0, updated: 0 };

  for (const fact of facts) {
    const where = { caseId_system_externalId: { caseId: fact.caseId, system: fact.system, externalId: fact.externalId } };
    const existing = await prisma.caseLink.findUnique({ where });
    const existingEvidence = (existing?.evidence as Record<string, unknown> | null) ?? {};
    const evidence = fact.evidenceMode === "merge" ? { ...existingEvidence, ...fact.evidence } : fact.evidence;
    const wasUnlinked = existing != null && existing.unlinkedAt != null;

    // `official_link` is the authoritative signal and wins `method` whenever
    // present, whichever producer ran first.
    const method = evidence.officialLink != null ? "official_link" : fact.methodOnUpdate;

    const eventFor = (source: LinkEventSource) =>
      prisma.normalizedEvent.create({
        data: {
          caseId: fact.caseId,
          sourceRawEventId: source.sourceRawEventId,
          type: "issue_linked",
          occurredAt: source.occurredAt,
          actor: "system",
          system: fact.system,
          sourceRole: fact.sourceRole,
          fromState: null,
          toState: null,
        },
      });

    // A re-link is a fresh event at the moment this run reconfirmed the link,
    // not the original link time, so the engine opens a new engineering span.
    const event = !existing ? fact.linkedEvent : wasUnlinked ? (fact.relinkedEvent ?? fact.linkedEvent) : null;

    await prisma.$transaction([
      prisma.caseLink.upsert({
        where,
        update: { ...(method === "keep" ? {} : { method }), evidence: evidence as Json, unlinkedAt: null },
        create: {
          caseId: fact.caseId,
          system: fact.system,
          externalId: fact.externalId,
          method: fact.method,
          confidence: "certain",
          evidence: evidence as Json,
          confirmedAt: new Date(),
        },
      }),
      ...(event ? [eventFor(event)] : []),
    ]);

    if (fact.repairLinkedEvent && !event) {
      // Checked independently of `existing`: a link can persist without its
      // event ever having landed (a run interrupted between the two writes of
      // an older version), and gating on the link's own existence would leave
      // that drift permanent.
      const present = await prisma.normalizedEvent.findFirst({
        where: { caseId: fact.caseId, type: "issue_linked", sourceRawEventId: fact.linkedEvent.sourceRawEventId },
        select: { id: true },
      });
      if (!present) await eventFor(fact.linkedEvent);
    }

    if (!existing) result.created += 1;
    else if (wasUnlinked) result.reactivated += 1;
    else result.updated += 1;
  }

  return result;
}

/**
 * Detects a removed link: a currently-active link whose record id is missing
 * from its issue's latest manifest. Account-wide by nature, so callers run it
 * only from an unscoped pass.
 *
 * The other source's evidence still present exempts the link from unlinking,
 * **unless** that source was itself already marked removed
 * (`<otherEvidenceKey>RemovedAt`). Without that second check, a link whose two
 * sources are both eventually removed, just not in the same run, would stay
 * linked forever: evidence only ever gains a key. An exempted-but-since-removed
 * source stamps its own `<evidenceKey>RemovedAt`, so the other sweep sees it
 * and finishes the unlink.
 *
 * Never deletes the row, its evidence, or any event: `unlinkedAt` only marks
 * the relationship inactive. The engine ends the current engineering span on
 * the `issue_unlinked` event without rewriting spans that already closed.
 */
export async function projectLinkSweep(
  prisma: PrismaClient,
  organizationId: string,
  sweep: LinkSweep,
): Promise<LinkSweepResult> {
  const result: LinkSweepResult = { unlinked: 0 };
  const removedKey = `${sweep.evidenceKey}RemovedAt`;
  const otherRemovedKey = `${sweep.otherEvidenceKey}RemovedAt`;

  const active = await prisma.caseLink.findMany({
    where: { system: sweep.system, unlinkedAt: null, case: { organizationId } },
    select: { id: true, caseId: true, externalId: true, evidence: true },
  });

  for (const link of active) {
    const evidence = (link.evidence as Record<string, unknown> | null) ?? {};
    const linkId = (evidence[sweep.evidenceKey] as { id?: number } | undefined)?.id;
    if (linkId == null) continue; // never had this source's evidence: nothing for this sweep to say
    const manifest = sweep.manifestFor(link.externalId);
    if (!manifest) continue; // no manifest for this issue: nothing to diff against
    if (manifest.activeLinkIds.has(linkId)) continue; // still current

    const otherStillProvesIt = evidence[sweep.otherEvidenceKey] != null && evidence[otherRemovedKey] == null;
    if (otherStillProvesIt) {
      if (evidence[removedKey] == null) {
        await prisma.caseLink.update({
          where: { id: link.id },
          data: { evidence: { ...evidence, [removedKey]: manifest.fetchedAt.toISOString() } as Json },
        });
      }
      continue;
    }

    await prisma.$transaction([
      prisma.caseLink.update({
        where: { id: link.id },
        data: {
          unlinkedAt: manifest.fetchedAt,
          evidence: { ...evidence, [removedKey]: manifest.fetchedAt.toISOString() } as Json,
        },
      }),
      prisma.normalizedEvent.create({
        data: {
          caseId: link.caseId,
          sourceRawEventId: manifest.rawEventId,
          type: "issue_unlinked",
          occurredAt: manifest.fetchedAt,
          actor: "system",
          system: sweep.system,
          sourceRole: sweep.sourceRole,
          fromState: null,
          toState: null,
        },
      }),
    ]);
    result.unlinked += 1;
  }

  return result;
}

export interface IssueRemoval {
  organizationId: string;
  system: IntegrationProvider;
  /** The removed issue's id in `system`. */
  externalId: string;
  /** The `RawEvent` that documents the removal; the `issue_unlinked` events cite it. */
  rawEventId: string;
  observedAt: Date;
  sourceRole: SourceRole;
}

/**
 * Ends every currently-active link to an issue the source reports gone (a
 * deleted-issue webhook, a 404 on refetch). Unlike `projectLinkSweep` this is
 * not diffed against a manifest: the source said so directly. Marks `unlinkedAt`
 * and emits one `issue_unlinked` event per link, atomically; a no-op when
 * nothing is active, so a redelivered webhook is harmless.
 */
export async function projectIssueRemoval(prisma: PrismaClient, removal: IssueRemoval): Promise<{ unlinked: number }> {
  const active = await prisma.caseLink.findMany({
    where: { system: removal.system, externalId: removal.externalId, unlinkedAt: null, case: { organizationId: removal.organizationId } },
    select: { id: true, caseId: true },
  });
  if (active.length === 0) return { unlinked: 0 };

  await prisma.$transaction(
    active.flatMap((link) => [
      prisma.caseLink.update({ where: { id: link.id }, data: { unlinkedAt: removal.observedAt } }),
      prisma.normalizedEvent.create({
        data: {
          caseId: link.caseId,
          sourceRawEventId: removal.rawEventId,
          type: "issue_unlinked",
          occurredAt: removal.observedAt,
          actor: "system",
          system: removal.system,
          sourceRole: removal.sourceRole,
          fromState: null,
          toState: null,
        },
      }),
    ]),
  );
  return { unlinked: active.length };
}
