import type { PrismaClient } from "@sla/db";
import type { CorrelationOutput, LinkFact, LinkManifest } from "@sla/ingestion";
import { INTERCOM_JIRA_LINK_EVENT_SOURCE_ROLE } from "./source-role";
import { INTERCOM_TICKET_CATEGORY_ATTRIBUTE, INTERCOM_TRACKER_CATEGORY, INTERCOM_TRACKER_TICKET_CATEGORY } from "./tracker";

/** The custom attribute Intercom's Jira integration writes onto the conversation or ticket it created an issue from. */
export const INTERCOM_JIRA_KEY_ATTRIBUTE = "jira_issue_key";

/** The `evidence` key this producer owns on its `CaseLink` rows; the unlink sweep reads it back. */
export const INTERCOM_JIRA_EVIDENCE_KEY = "intercomJiraKey";

const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

interface SnapshotRow {
  id: string;
  conversationId: string;
  fetchedAt: Date;
  /** The attribute's JSON value: a string when set, `null`/absent when cleared. */
  key: unknown;
  category: string | null;
  /** Ids of the Tracker tickets this snapshot's `linked_objects` names. */
  trackers: string[];
}

interface Snapshot {
  rawEventId: string;
  fetchedAt: Date;
  /** The trimmed attribute value, or `null` when the snapshot carries none. */
  key: string | null;
  trackers: string[];
}

/** For one (conversation, issue key): the snapshots that first established it, last re-established it and last ended it. */
interface Span {
  first: Snapshot;
  lastStart: Snapshot;
  lastStop: Snapshot | null;
}

/** Issue key -> the Tracker it came through, or `null` when the conversation carries the key itself. */
type Holds = Map<string, string | null>;

/**
 * Deterministic-tier correlator for Jira issues created from Intercom's own
 * Jira integration, the Intercom-side counterpart to `correlateZendeskJiraLinks`
 * (packages/zendesk/src/correlate.ts). That integration leaves nothing on the
 * Jira issue (no remote link, issue link, label or description), so
 * `correlateJira` can never see the relationship. The only record is the
 * `jira_issue_key` custom attribute on the Intercom object the issue was
 * created from.
 *
 * Which Case it belongs to follows from what that object is:
 *  - A conversation or customer ticket carrying the key links its own Case.
 *  - A Tracker ticket (./tracker) is not a Case, just as a Zendesk Jira-link
 *    record is not. It is the link between customer conversations and an
 *    engineering issue, so its key lands on every conversation whose
 *    `linked_objects` names it as a `Tracker`: many conversations can share one
 *    tracker, and one conversation can have several. Only the structural
 *    reference counts, never a matching title or timestamp.
 *
 * Every snapshot of a conversation (`conversation:{id}:{hash}`; Intercom bumps
 * `updated_at`, so each change is a new one) is an observation at its
 * `fetchedAt`. Per conversation the observations of itself and of its trackers
 * are replayed in order, and a (conversation, key) relationship holds while the
 * conversation lists a tracker that carries the key, or carries it itself:
 *  - `linkedEvent` is the first snapshot at which it held; `relinkedEvent` (it
 *    came back after ending) the snapshot that re-established it.
 *  - One that no longer holds (key cleared or replaced, tracker unlinked) is
 *    unlinked by the sweep below, never deleted: `unlinkedAt` marks the row
 *    inactive, its evidence and events are kept.
 *
 * The evidence lives under its own key (`intercomJiraKey`), not `officialLink`:
 * the Zendesk sweep reads `officialLink.id` against Zendesk's link registry and
 * would unlink these. `method` is still `official_link`, as the attribute is
 * the integration's own structured record rather than a URL to parse.
 *
 * The sweep's "manifest" is derived, not fetched: per issue key, the
 * conversations that hold it now (`evidence.intercomJiraKey.id`). A link whose
 * conversation has left that set is unlinked, unless a Jira `remoteLink`
 * independently still proves it. That also retires a link an earlier version
 * wrote onto a Tracker's own Case, which is never a holder.
 *
 * Must be projected after the Intercom batch (`buildIntercomBatch`), which
 * creates the Cases this looks up by conversation id; `syncIntegration`
 * already runs a ticket source's correlation after its normalization.
 */
export async function correlateIntercomJiraKeys(prisma: PrismaClient, integrationId: string): Promise<CorrelationOutput> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const output: CorrelationOutput = { links: [], sweeps: [], evaluated: 0, unmatched: {} };
  const unmatch = (reason: string) => (output.unmatched[reason] = (output.unmatched[reason] ?? 0) + 1);

  // Every snapshot of each conversation that ever carried the attribute, or
  // that ever listed a tracker which did (whole conversations, not rows, so a
  // later snapshot that dropped it is seen). Only the few fields leave the database, not the payload.
  const rows = await prisma.$queryRaw<SnapshotRow[]>`
    WITH snapshots AS (
      SELECT id,
             split_part("providerEventId", ':', 2) AS "conversationId",
             "fetchedAt",
             payload -> 'custom_attributes' -> ${INTERCOM_JIRA_KEY_ATTRIBUTE}::text AS key,
             payload -> 'custom_attributes' ->> ${INTERCOM_JIRA_KEY_ATTRIBUTE}::text AS key_text,
             payload -> 'custom_attributes' ->> ${INTERCOM_TICKET_CATEGORY_ATTRIBUTE}::text AS category,
             ARRAY(
               SELECT link ->> 'id'
               FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(payload -> 'linked_objects' -> 'data') = 'array' THEN payload -> 'linked_objects' -> 'data' ELSE '[]'::jsonb END
               ) AS link
               WHERE link ->> 'type' = 'ticket' AND link ->> 'category' = ${INTERCOM_TRACKER_CATEGORY}::text
             ) AS trackers
      FROM raw_events
      WHERE "integrationId" = ${integrationId} AND "providerEventId" LIKE 'conversation:%'
    ),
    keyed AS (SELECT DISTINCT "conversationId" FROM snapshots WHERE key_text IS NOT NULL),
    relevant AS (
      SELECT "conversationId" FROM keyed
      UNION
      SELECT "conversationId" FROM snapshots WHERE trackers && ARRAY(SELECT "conversationId" FROM keyed)
    )
    SELECT id, "conversationId", "fetchedAt", key, category, trackers
    FROM snapshots
    WHERE "conversationId" IN (SELECT "conversationId" FROM relevant)
    ORDER BY "conversationId", "fetchedAt", id`;

  const byConversation = new Map<string, Snapshot[]>();
  const categoryOf = new Map<string, string | null>();
  const listedTrackers = new Set<string>();
  for (const row of rows) {
    const snapshot: Snapshot = { rawEventId: row.id, fetchedAt: row.fetchedAt, key: normalizeKey(row.key), trackers: row.trackers };
    const list = byConversation.get(row.conversationId);
    if (list) list.push(snapshot);
    else byConversation.set(row.conversationId, [snapshot]);
    categoryOf.set(row.conversationId, row.category); // rows are in order: the last wins
    for (const id of row.trackers) listedTrackers.add(id);
  }
  output.evaluated = byConversation.size;

  const isTracker = (conversationId: string) =>
    listedTrackers.has(conversationId) || categoryOf.get(conversationId) === INTERCOM_TRACKER_TICKET_CATEGORY;

  const knownKeys = new Set<string>();
  for (const snapshots of byConversation.values()) {
    for (const { key } of snapshots) if (key && JIRA_ISSUE_KEY.test(key)) knownKeys.add(key);
  }

  const cases = await prisma.case.findMany({
    where: { organizationId: integration.organizationId, sourceIntegrationId: integrationId, externalId: { in: [...byConversation.keys()] } },
    select: { id: true, externalId: true, deletedAt: true },
  });
  const caseByConversation = new Map(cases.map((c) => [c.externalId, c]));

  /** Per issue key: the conversations that hold it now. */
  const carriers = new Map<string, Set<number>>();
  /** Per issue key: the latest snapshot at which a relationship ended, or that a Tracker's own Case (older versions) was linked from. */
  const ended = new Map<string, Snapshot>();
  const noteEnded = (key: string, snapshot: Snapshot) => {
    const previous = ended.get(key);
    if (!previous || snapshot.fetchedAt >= previous.fetchedAt) ended.set(key, snapshot);
  };

  for (const [conversationId, snapshots] of byConversation) {
    if (isTracker(conversationId)) {
      // Never a holder. A link an earlier version put on its Case is retired by the sweep.
      for (const snapshot of snapshots) if (snapshot.key && JIRA_ISSUE_KEY.test(snapshot.key)) noteEnded(snapshot.key, snapshot);
      continue;
    }
    const idNumber = Number(conversationId);
    if (!Number.isSafeInteger(idNumber)) {
      unmatch("invalidIdentifier");
      continue;
    }

    const { holds, spans, invalid } = replay(snapshots, byConversation);
    for (let i = 0; i < invalid; i += 1) unmatch("invalidIssueKey");
    for (const [key, span] of spans) if (!holds.has(key) && span.lastStop) noteEnded(key, span.lastStop);

    for (const [key, via] of holds) {
      const carrying = carriers.get(key);
      if (carrying) carrying.add(idNumber);
      else carriers.set(key, new Set([idNumber]));

      const caseRow = caseByConversation.get(conversationId);
      if (!caseRow || caseRow.deletedAt) {
        unmatch("noCase");
        continue;
      }
      const span = spans.get(key)!;
      const fact: LinkFact = {
        caseId: caseRow.id,
        system: "jira",
        externalId: key,
        method: "official_link",
        methodOnUpdate: "official_link",
        evidence: {
          [INTERCOM_JIRA_EVIDENCE_KEY]: {
            id: idNumber,
            conversationId,
            attribute: INTERCOM_JIRA_KEY_ATTRIBUTE,
            value: key,
            ...(via ? { trackerId: via } : {}),
          },
        },
        evidenceMode: "merge",
        sourceRole: INTERCOM_JIRA_LINK_EVENT_SOURCE_ROLE,
        linkedEvent: { sourceRawEventId: span.first.rawEventId, occurredAt: span.first.fetchedAt },
        // A re-link is a fresh event at the moment the relationship was re-established, so the engine opens a new engineering span.
        relinkedEvent: { sourceRawEventId: span.lastStart.rawEventId, occurredAt: span.lastStart.fetchedAt },
        repairLinkedEvent: false,
      };
      output.links.push(fact);
    }
  }

  output.sweeps.push({
    system: "jira",
    evidenceKey: INTERCOM_JIRA_EVIDENCE_KEY,
    otherEvidenceKey: "remoteLink",
    sourceRole: INTERCOM_JIRA_LINK_EVENT_SOURCE_ROLE,
    manifestFor(issueKey): LinkManifest | null {
      if (!knownKeys.has(issueKey)) return null; // nothing this integration ingested ever named it
      // The removal is documented by the snapshot that ended it. With none
      // there is nothing to unlink, so any snapshot that names the key will do.
      const documenting = ended.get(issueKey) ?? latestSnapshotNaming(byConversation, issueKey);
      if (!documenting) return null;
      return { rawEventId: documenting.rawEventId, fetchedAt: documenting.fetchedAt, activeLinkIds: carriers.get(issueKey) ?? new Set() };
    },
  });

  return output;
}

/**
 * Replays one conversation's snapshots together with those of the trackers it
 * ever listed, in time order, tracking which issue keys it holds after each.
 * Pure: the history of every key it ever held, what it holds now, and how many
 * values it could not read as an issue key.
 */
function replay(
  own: Snapshot[],
  byConversation: ReadonlyMap<string, Snapshot[]>,
): { holds: Holds; spans: Map<string, Span>; invalid: number } {
  const trackerIds = [...new Set(own.flatMap((s) => s.trackers))].filter((id) => byConversation.has(id));
  const timeline = [
    ...own.map((snapshot) => ({ snapshot, tracker: null as string | null })),
    ...trackerIds.flatMap((tracker) => byConversation.get(tracker)!.map((snapshot) => ({ snapshot, tracker }))),
  ].sort((a, b) => a.snapshot.fetchedAt.getTime() - b.snapshot.fetchedAt.getTime() || a.snapshot.rawEventId.localeCompare(b.snapshot.rawEventId));

  let ownKey: string | null = null;
  let listed = new Set<string>();
  const trackerKey = new Map<string, string | null>();
  let holds: Holds = new Map();
  const spans = new Map<string, Span>();

  const holdsNow = (): Holds => {
    const next: Holds = new Map();
    if (ownKey && JIRA_ISSUE_KEY.test(ownKey)) next.set(ownKey, null);
    for (const tracker of listed) {
      const key = trackerKey.get(tracker);
      if (key && JIRA_ISSUE_KEY.test(key) && !next.has(key)) next.set(key, tracker);
    }
    return next;
  };

  for (const { snapshot, tracker } of timeline) {
    if (tracker === null) {
      ownKey = snapshot.key;
      listed = new Set(snapshot.trackers);
    } else {
      trackerKey.set(tracker, snapshot.key);
    }
    const next = holdsNow();
    for (const key of next.keys()) {
      if (holds.has(key)) continue;
      const span = spans.get(key);
      if (span) span.lastStart = snapshot;
      else spans.set(key, { first: snapshot, lastStart: snapshot, lastStop: null });
    }
    for (const key of holds.keys()) if (!next.has(key)) spans.get(key)!.lastStop = snapshot;
    holds = next;
  }

  const candidates = [ownKey, ...[...listed].map((tracker) => trackerKey.get(tracker) ?? null)];
  const invalid = candidates.filter((key) => key && !JIRA_ISSUE_KEY.test(key)).length;
  return { holds, spans, invalid };
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") return value == null ? null : String(value);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function latestSnapshotNaming(byConversation: ReadonlyMap<string, Snapshot[]>, issueKey: string): Snapshot | null {
  let latest: Snapshot | null = null;
  for (const snapshots of byConversation.values()) {
    for (const snapshot of snapshots) {
      if (snapshot.key === issueKey && (!latest || snapshot.fetchedAt >= latest.fetchedAt)) latest = snapshot;
    }
  }
  return latest;
}
