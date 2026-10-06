import { Prisma } from "../generated/prisma/client";
import type { IntegrationProvider, PrismaClient } from "../generated/prisma/client";
import {
  finishIntegrationDataOperation,
  startIntegrationDataOperation,
  type DataOperationActor,
} from "./integration-data-operations";
import { countIntegrationData, integrationDataWhere } from "./integration-data-scope";
import { withOrganizationSlaLock } from "./organization-lock";

/**
 * Explicit "Clean up data" for one disconnected integration — a separate
 * action from disconnect, which never deletes anything, and from backup, which
 * it never creates or requires.
 *
 * Scope is the one `Integration` row, never the organization, and is defined
 * once in `integrationDataWhere` (the same definition the Data page's counts
 * and the backup export use). What is owned by the integration and removed:
 *
 *  - Its `RawEvent` rows, and every `NormalizedEvent` derived from them
 *    (`sourceRawEventId`), on whichever case the event sits — a Jira event on
 *    a Zendesk case is Jira's, not the case's.
 *  - The `Case` rows it created. A case is the ticket source's entity, so its
 *    commitments, evaluations, notifications, leg spans, links and the events
 *    other sources attached to it go with it (the schema cascades).
 *  - Its `CustomerIdentity` rows, and then each customer those identities
 *    named — but only if nothing else still needs it (see below).
 *  - Its own evidence on `CaseLink` rows that sit on other integrations'
 *    cases (e.g. Jira's `remoteLink` on a Zendesk case).
 *  - The sync state that describes the deleted data: `cursor`, the
 *    normalization watermark and a pending renormalize request, so a later
 *    reconnect backfills from scratch instead of resuming past data that is
 *    gone.
 *
 * What is shared or organization-level, and is kept:
 *
 *  - The `Integration` row itself (status stays `disconnected`), its
 *    `webhookSecret`, `connectedAt`, `disconnectedAt` and last-sync history,
 *    and the `IntegrationConfig` (OAuth app) — config is deleted only by its
 *    own action.
 *  - Other integrations' raw events and normalized events, and cases.
 *  - A `CaseLink` another producer still evidences (`officialLink` from
 *    Zendesk, `intercomJiraKey` from Intercom): only this integration's
 *    evidence is stripped; the row stays.
 *  - A `Customer` that still has a case from another integration, another
 *    provider's identity, a calendar override, or a reference from an SLA
 *    policy's match. Customers this integration's identities did not name
 *    are never touched.
 *  - SLA policies, calendars and `SlaImportSummary`: organization
 *    configuration (users edit them, other integrations' commitments are
 *    frozen onto their versions), not imported ticket data.
 *
 * Refused unless the integration is `disconnected`: a connected one would
 * repopulate straight away and race the worker. Recorded as an
 * `IntegrationDataOperation` (started, then completed or failed).
 */

/** Evidence keys written by a ticket source's own correlation, not by the engineering integration the link points at. */
const OTHER_PRODUCER_EVIDENCE_KEYS = ["officialLink", "intercomJiraKey"] as const;

/** Chunk size for `id IN (...)` lists — far below Postgres' bind-parameter limit. */
const ID_CHUNK = 5_000;

const CLEANUP_TRANSACTION_TIMEOUT_MS = 15 * 60_000;

export interface IntegrationCleanupCounts {
  rawEvents: number;
  /** Events removed because they derive from this integration's raw events (events that went with a deleted case are not counted here). */
  normalizedEvents: number;
  cases: number;
  /** Links removed outright because nothing but this integration evidenced them. */
  caseLinksRemoved: number;
  /** Links kept because another producer still evidences them; only this integration's evidence was stripped. */
  caseLinksTrimmed: number;
  customerIdentities: number;
  customers: number;
}

export type CleanupIntegrationDataResult =
  | { status: "not_found" }
  /** Refused: only a disconnected integration can be cleaned up. */
  | { status: "not_disconnected" }
  | { status: "cleaned"; counts: IntegrationCleanupCounts };

function chunked<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += ID_CHUNK) chunks.push(items.slice(i, i + ID_CHUNK));
  return chunks;
}

/** The evidence a link keeps once this integration's own is stripped: only other producers' keys, or null when none of theirs is present. */
function otherProducersEvidence(evidence: unknown): Record<string, Prisma.InputJsonValue> | null {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const record = evidence as Record<string, Prisma.InputJsonValue>;
  const kept: Record<string, Prisma.InputJsonValue> = {};
  for (const key of OTHER_PRODUCER_EVIDENCE_KEYS) {
    if (record[key] !== undefined) kept[key] = record[key];
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

export async function cleanupIntegrationData(
  prisma: PrismaClient,
  organizationId: string,
  provider: IntegrationProvider,
  actor: DataOperationActor,
): Promise<CleanupIntegrationDataResult> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { id: true, status: true },
  });
  if (!integration) return { status: "not_found" };
  if (integration.status !== "disconnected") return { status: "not_disconnected" };

  // Same lock as normalization, the worker cycle and webhook deliveries, so no
  // projection writes onto a case (or a raw event) while it is being deleted.
  return withOrganizationSlaLock(prisma, organizationId, async () => {
    // Re-checked under the lock: a reconnect may have landed while this waited.
    const current = await prisma.integration.findUnique({
      where: { id: integration.id },
      select: { status: true },
    });
    if (current?.status !== "disconnected") return { status: "not_disconnected" } as const;

    const integrationId = integration.id;
    const where = integrationDataWhere(organizationId, { id: integrationId, provider });

    const scope = await countIntegrationData(prisma, organizationId, { id: integrationId, provider });
    const operationId = await startIntegrationDataOperation(prisma, {
      organizationId,
      integrationId,
      provider,
      kind: "cleanup",
      actor,
      details: { scope },
    });

    try {
      const counts = await prisma.$transaction(
        async (tx) => {
          // Customers this integration's identities named, read before the
          // identities go: the only customers this cleanup may consider deleting.
          const candidateCustomerIds = [
            ...new Set(
              (await tx.customerIdentity.findMany({ where: where.customerIdentities, select: { customerId: true } })).map(
                (identity) => identity.customerId,
              ),
            ),
          ];

          // RESTRICT on `sourceRawEventId`: events first, then the cases, then the raw events.
          const normalizedEvents = await tx.normalizedEvent.deleteMany({
            where: { sourceRawEvent: { integrationId } },
          });
          const cases = await tx.case.deleteMany({ where: where.ownedCases });
          const rawEvents = await tx.rawEvent.deleteMany({ where: where.rawEvents });

          // Links on cases that survive (another integration's). Links on the
          // deleted cases went with them.
          const links = await tx.caseLink.findMany({
            where: { system: provider, case: { organizationId } },
            select: { id: true, evidence: true },
          });
          const removeIds: string[] = [];
          let caseLinksTrimmed = 0;
          for (const link of links) {
            const kept = otherProducersEvidence(link.evidence);
            if (!kept) {
              removeIds.push(link.id);
              continue;
            }
            const evidence = link.evidence as Record<string, unknown>;
            // Only another producer's evidence on this row: nothing of ours to strip.
            if (Object.keys(evidence).every((key) => key in kept)) continue;
            await tx.caseLink.update({
              where: { id: link.id },
              // Both remaining producers record a structured link, never a parsed URL.
              data: { evidence: kept, method: "official_link" },
            });
            caseLinksTrimmed += 1;
          }
          let caseLinksRemoved = 0;
          for (const ids of chunked(removeIds)) {
            caseLinksRemoved += (await tx.caseLink.deleteMany({ where: { id: { in: ids } } })).count;
          }

          const customerIdentities = await tx.customerIdentity.deleteMany({ where: where.customerIdentities });

          // A customer goes only when nothing else needs it.
          let customers = 0;
          if (candidateCustomerIds.length > 0) {
            const policyVersions = await tx.sLAPolicyVersion.findMany({
              where: { policy: { organizationId } },
              select: { match: true },
            });
            const policyMatches = policyVersions.map((version) => JSON.stringify(version.match));

            for (const ids of chunked(candidateCustomerIds)) {
              const orphans = await tx.customer.findMany({
                where: {
                  id: { in: ids },
                  organizationId,
                  cases: { none: {} },
                  identities: { none: {} },
                  calendarId: null,
                },
                select: { id: true },
              });
              const deletable = orphans
                .map((customer) => customer.id)
                .filter((id) => !policyMatches.some((match) => match.includes(id)));
              if (deletable.length === 0) continue;
              customers += (await tx.customer.deleteMany({ where: { id: { in: deletable } } })).count;
            }
          }

          await tx.integration.update({
            where: { id: integrationId },
            data: {
              // SQL NULL, the state of an integration that never synced.
              cursor: Prisma.DbNull,
              normalizedThroughFetchedAt: null,
              normalizedThroughId: null,
              renormalizeRequestedAt: null,
            },
          });

          return {
            rawEvents: rawEvents.count,
            normalizedEvents: normalizedEvents.count,
            cases: cases.count,
            caseLinksRemoved,
            caseLinksTrimmed,
            customerIdentities: customerIdentities.count,
            customers,
          } satisfies IntegrationCleanupCounts;
        },
        { timeout: CLEANUP_TRANSACTION_TIMEOUT_MS, maxWait: 60_000 },
      );

      await finishIntegrationDataOperation(prisma, operationId, {
        status: "completed",
        details: { scope, deleted: counts },
      });
      return { status: "cleaned", counts } as const;
    } catch (error) {
      await finishIntegrationDataOperation(prisma, operationId, {
        status: "failed",
        error: error instanceof Error ? error.name : "Error",
        details: { scope },
      });
      throw error;
    }
  });
}
