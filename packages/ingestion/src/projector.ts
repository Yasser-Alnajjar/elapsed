import {
  findCustomerByIdentity,
  Prisma,
  upsertCustomerByIdentity,
  type CustomerIdentityRef as DbCustomerIdentityRef,
  type PrismaClient,
} from "@sla/db";
import type { CanonicalBatch, CaseFacts, CustomerIdentityRef, EventGroup, IntegrationRef, ProjectionFailure } from "./contract";
import { caseFieldsChanged, STORED_CASE_FIELDS, type StoredCaseFields } from "./case-change";
import { diffNormalizedEvents } from "./diff";

export interface ProjectionResult {
  customersUpserted: number;
  /** Customers the batch created or renamed: actual changes, unlike `customersUpserted`, which counts the ones processed. */
  customersChanged: number;
  casesUpserted: number;
  /** Cases the batch created or whose stored fields it changed, found by comparing with what was stored before the write (D32). `casesUpserted` counts the ones processed. */
  casesChanged: number;
  casesDeleted: number;
  /** Events the batch derived, whether or not they needed writing. */
  eventsDerived: number;
  eventsCreated: number;
  eventsDeleted: number;
  failures: ProjectionFailure[];
}

/**
 * Persists one integration's canonical batch: the only code that writes
 * `Customer`, `CustomerIdentity`, `Case` and `NormalizedEvent` rows. Runs
 * inside the caller's organization lock, like the per-provider code it
 * replaces, and is scope-agnostic: it persists whatever batch it is given.
 *
 * A record that fails is reported in `failures` and the rest of the batch is
 * still projected.
 */
export async function projectCanonicalBatch(
  prisma: PrismaClient,
  integration: IntegrationRef,
  batch: CanonicalBatch,
): Promise<ProjectionResult> {
  const result: ProjectionResult = {
    customersUpserted: 0,
    customersChanged: 0,
    casesUpserted: 0,
    casesChanged: 0,
    casesDeleted: 0,
    eventsDerived: 0,
    eventsCreated: 0,
    eventsDeleted: 0,
    failures: [...batch.failures],
  };

  for (const customer of batch.customers) {
    const identity = dbIdentityRef(integration, customer);
    const before = await findCustomerByIdentity(prisma, identity);
    await upsertCustomerByIdentity(prisma, identity, customer.name);
    result.customersUpserted += 1;
    if (!before || before.name !== customer.name) result.customersChanged += 1;
  }

  const caseIdByExternalId = new Map<string, string>();
  const storedCases = await loadStoredCases(prisma, integration, batch.cases.map((facts) => facts.externalId));
  for (const facts of batch.cases) {
    try {
      const row = await upsertCase(prisma, integration, facts);
      caseIdByExternalId.set(facts.externalId, row.id);
      result.casesUpserted += 1;
      const stored = storedCases.get(facts.externalId);
      if (!stored || caseFieldsChanged(stored, facts, row.customerId)) result.casesChanged += 1;
    } catch (error) {
      result.failures.push({ id: facts.externalId, error: errorMessage(error) });
    }
  }

  if (batch.deletedCaseExternalIds.length > 0) {
    const { count } = await prisma.case.updateMany({
      where: {
        organizationId: integration.organizationId,
        sourceIntegrationId: integration.id,
        externalId: { in: batch.deletedCaseExternalIds },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
    result.casesDeleted = count;
  }

  for (const group of batch.eventGroups) {
    try {
      const caseId = await resolveTargetCaseId(prisma, integration, group, caseIdByExternalId);
      const { created, deleted } = await reconcileEvents(prisma, integration, caseId, group);
      result.eventsDerived += group.events.length;
      result.eventsCreated += created;
      result.eventsDeleted += deleted;
    } catch (error) {
      result.failures.push({ id: group.recordId, error: errorMessage(error) });
    }
  }

  return result;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function dbIdentityRef(integration: IntegrationRef, ref: CustomerIdentityRef): DbCustomerIdentityRef {
  return { organizationId: integration.organizationId, provider: ref.provider, kind: ref.kind, externalId: ref.externalId };
}

const STORED_CASE_CHUNK = 1000;

/** What is stored for these cases before the batch writes them; read only, to tell a change from a re-write of the same values. */
async function loadStoredCases(
  prisma: PrismaClient,
  integration: IntegrationRef,
  externalIds: string[],
): Promise<Map<string, StoredCaseFields>> {
  const stored = new Map<string, StoredCaseFields>();
  for (let i = 0; i < externalIds.length; i += STORED_CASE_CHUNK) {
    const rows = await prisma.case.findMany({
      where: {
        organizationId: integration.organizationId,
        sourceIntegrationId: integration.id,
        externalId: { in: externalIds.slice(i, i + STORED_CASE_CHUNK) },
      },
      select: { externalId: true, ...STORED_CASE_FIELDS },
    });
    for (const { externalId, ...fields } of rows) stored.set(externalId, fields);
  }
  return stored;
}

async function upsertCase(
  prisma: PrismaClient,
  integration: IntegrationRef,
  facts: CaseFacts,
): Promise<{ id: string; customerId: string | null }> {
  const customer = facts.customer ? await findCustomerByIdentity(prisma, dbIdentityRef(integration, facts.customer)) : null;
  const shared = {
    customerId: customer?.id ?? null,
    subject: facts.subject,
    assigneeName: facts.assigneeName,
    priority: facts.priority,
    channel: facts.channel,
    closedAt: facts.closedAt,
    sourceIntegrationId: integration.id,
    requesterName: facts.requesterName,
    tier: facts.tier,
    tags: facts.tags,
    attributes: facts.attributes === undefined ? undefined : facts.attributes === null ? Prisma.DbNull : (facts.attributes as Prisma.InputJsonValue),
  };
  const row = await prisma.case.upsert({
    where: {
      organizationId_sourceIntegrationId_externalId: {
        organizationId: integration.organizationId,
        sourceIntegrationId: integration.id,
        externalId: facts.externalId,
      },
    },
    // `system` and `openedAt` are set once, at creation. `deletedAt` is never
    // cleared here: a source that stops reporting a case does not un-delete it.
    update: shared,
    create: {
      ...shared,
      organizationId: integration.organizationId,
      externalId: facts.externalId,
      system: integration.provider,
      openedAt: facts.openedAt,
    },
  });
  return { id: row.id, customerId: row.customerId };
}

async function resolveTargetCaseId(
  prisma: PrismaClient,
  integration: IntegrationRef,
  group: EventGroup,
  caseIdByExternalId: Map<string, string>,
): Promise<string> {
  if ("caseId" in group.target) return group.target.caseId;
  const { caseExternalId } = group.target;
  const known = caseIdByExternalId.get(caseExternalId);
  if (known) return known;
  const row = await prisma.case.findUnique({
    where: {
      organizationId_sourceIntegrationId_externalId: {
        organizationId: integration.organizationId,
        sourceIntegrationId: integration.id,
        externalId: caseExternalId,
      },
    },
    select: { id: true },
  });
  if (!row) throw new Error(`No case ${caseExternalId} to attach events to`);
  return row.id;
}

/**
 * Reconciles against what is stored instead of deleting and recreating every
 * event: unchanged events keep their id and `createdAt` (which the worker's
 * "cases with new events" lookback relies on), and an unchanged record writes
 * nothing at all.
 */
async function reconcileEvents(
  prisma: PrismaClient,
  integration: IntegrationRef,
  caseId: string,
  group: EventGroup,
): Promise<{ created: number; deleted: number }> {
  const stored =
    group.ownRawEventIds.length === 0
      ? []
      : await prisma.normalizedEvent.findMany({
          // `issue_linked` / `issue_unlinked` belong to the link projector, never to a
          // batch: a ticket source's own correlator cites its own snapshots (Intercom's
          // `jira_issue_key`), which are in `ownRawEventIds`, and must not be reconciled away.
          where: { caseId, sourceRawEventId: { in: group.ownRawEventIds }, type: { notIn: ["issue_linked", "issue_unlinked"] } },
          select: {
            id: true,
            sourceRawEventId: true,
            type: true,
            occurredAt: true,
            actor: true,
            sourceRole: true,
            fromState: true,
            toState: true,
            sourceSequence: true,
          },
        });
  const { toCreate, toDeleteIds } = diffNormalizedEvents(stored, group.events);

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  if (toDeleteIds.length > 0) writes.push(prisma.normalizedEvent.deleteMany({ where: { id: { in: toDeleteIds } } }));
  if (toCreate.length > 0) {
    writes.push(
      prisma.normalizedEvent.createMany({
        data: toCreate.map((event) => ({
          caseId,
          sourceRawEventId: event.sourceRawEventId,
          type: event.type,
          occurredAt: event.occurredAt,
          actor: event.actor,
          system: integration.provider,
          sourceRole: event.sourceRole,
          fromState: event.fromState,
          toState: event.toState,
          sourceSequence: event.sourceSequence,
        })) satisfies Prisma.NormalizedEventCreateManyInput[],
      }),
    );
  }
  if (group.linkEvidencePatch) {
    const { externalId, patch } = group.linkEvidencePatch;
    const link = await prisma.caseLink.findUnique({
      where: { caseId_system_externalId: { caseId, system: integration.provider, externalId } },
      select: { id: true, evidence: true },
    });
    const existing = (link?.evidence as Record<string, unknown> | null) ?? {};
    if (link && Object.entries(patch).some(([key, value]) => JSON.stringify(existing[key]) !== JSON.stringify(value))) {
      writes.push(
        prisma.caseLink.update({ where: { id: link.id }, data: { evidence: { ...existing, ...patch } as Prisma.InputJsonValue } }),
      );
    }
  }
  if (writes.length > 0) await prisma.$transaction(writes);
  return { created: toCreate.length, deleted: toDeleteIds.length };
}
