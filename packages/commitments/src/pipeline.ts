import type { Prisma, PrismaClient } from "@sla/db";
import {
  createCommitment,
  matchPolicyVersion,
  resolveFirstResponseStartedAt,
  type BusinessCalendarVersion,
  type CaseAttributes,
  type CommitmentKind,
  type NormalizedEvent,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
} from "@sla/core";
import { toNormalizedEventDomain } from "./evaluate-pipeline";
import { toCalendarVersionDomain } from "./calendar-domain";
import { resolveEffectiveCalendarVersion, resolveOrganizationCalendarFallback } from "./calendar-fallback";
import { toPolicyVersionDomain } from "./policy-domain";
import { chunk, loadPolicyContext, type PolicyContext } from "./tick-context";

export { toCalendarVersionDomain } from "./calendar-domain";

/** The single-cycle kinds this pipeline creates. Also `runNextReplyCyclePipeline`'s anchor kinds (cycle-pipeline.ts). */
export const COMMITMENT_KINDS: CommitmentKind[] = [
  "first_response",
  "resolution",
];

export interface CaseRecord {
  id: string;
  priority: string | null;
  customerId: string | null;
  tier: string | null;
  openedAt: Date;
  /** Source ticket's tags (e.g. a Zendesk ticket's `tags`) — a generic SLA policy match input, mirrored into `attributes.tags` below. Provider-specific aliases of it (Zendesk's `current_tags`) are written by that provider's adapter into `attributes`. */
  tags?: string[];
  /** Source ticket's channel (e.g. a Zendesk ticket's `via.channel`) — mirrored into `attributes.channel` below. Provider-specific aliases of it (Zendesk's `via_id`/`current_via_id`) are written by that provider's adapter into `attributes`. */
  channel?: string | null;
  /** The ticket-source provider that created the case (`Case.system`) — becomes `CaseAttributes.sourceKey`, so an imported policy scoped to another source is not a candidate (N1.11). Opaque to the core. */
  system?: string;
  /**
   * Every other generic, source-specific SLA policy match input (Zendesk's
   * `status`, `type`, `group_id`, `assignee_id`, `custom_fields_<id>`, ... —
   * see `zendeskConditionAttributes`, packages/zendesk/src/normalize.ts).
   * Merged as-is; canonical fields above always win on key collision since
   * they're the authoritative column. Typed `unknown` rather than
   * `Record<string, unknown>` so a Prisma `Json` column's value (which can
   * statically be a primitive/array, even though this column only ever
   * stores a plain object) is assignable without a cast at every call site.
   */
  attributes?: unknown;
}

/** True for a plain JSON object — excludes arrays, primitives, and null, which a `Json` column can hold in principle but `attributes` never actually does. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Builds packages/core's `CaseAttributes` from a persisted Case row. */
export function toCaseAttributes(caseRow: CaseRecord): CaseAttributes {
  return {
    caseId: caseRow.id,
    ...(caseRow.system != null ? { sourceKey: caseRow.system } : {}),
    attributes: {
      ...(isPlainObject(caseRow.attributes) ? caseRow.attributes : {}),
      ...(caseRow.priority != null ? { priority: caseRow.priority } : {}),
      ...(caseRow.customerId != null ? { customerId: caseRow.customerId } : {}),
      ...(caseRow.tier != null ? { tier: caseRow.tier } : {}),
      ...(caseRow.tags != null ? { tags: caseRow.tags } : {}),
      ...(caseRow.channel != null ? { channel: caseRow.channel } : {}),
    },
    priority: caseRow.priority ?? undefined,
    customerId: caseRow.customerId ?? undefined,
    tier: caseRow.tier ?? undefined,
  };
}

export interface PolicyVersionRecord {
  id: string;
  policyId: string;
  version: number;
  match: SLAPolicyMatch;
  targets: { kind: CommitmentKind; minutes: number }[];
  pauseOnStates: NormalizedState[];
  calendarVersionId: string;
  warnAtPercent: number[];
  effectiveFrom: string;
  /** D6/1.10 — the owning `SLAPolicy.position`; null for a manual policy or a pre-D6 import. */
  policyPosition?: number | null;
  /** Whether a calendar was explicitly chosen for this version (4i, defaults to true) — see `resolveEffectiveCalendarVersion`, calendar-fallback.ts. */
  calendarIsExplicit?: boolean;
}

/**
 * "Active" means the current version of each policy (Phase 13.6: editing
 * creates a new version; old versions are never destroyed, but they stop
 * being candidates for *new* commitments — existing commitments keep the
 * version id they were created under regardless).
 */
export function latestVersionPerPolicy(
  versions: PolicyVersionRecord[],
): PolicyVersionRecord[] {
  const latestByPolicyId = new Map<string, PolicyVersionRecord>();
  for (const version of versions) {
    const current = latestByPolicyId.get(version.policyId);
    if (!current || version.version > current.version)
      latestByPolicyId.set(version.policyId, version);
  }
  return [...latestByPolicyId.values()];
}

/** Which of the two commitment kinds a Case doesn't have yet. */
export function missingCommitmentKinds(
  existingKinds: CommitmentKind[],
): CommitmentKind[] {
  const existing = new Set(existingKinds);
  return COMMITMENT_KINDS.filter((kind) => !existing.has(kind));
}

/**
 * Deterministically picks the sibling/anchor commitment used to inherit a
 * case's frozen policy and calendar version (E-1: `commitments[0]` off an
 * unordered query picked whichever row Postgres happened to return first).
 * Resolution outlives first_response and keeps re-resolving onto the
 * currently applicable policy for as long as it stays open, so it is the
 * fresher source of truth whenever both exist; first_response is the only
 * option otherwise.
 */
export function pickAnchorCommitment<T extends { kind: CommitmentKind }>(
  commitments: T[],
): T | undefined {
  return commitments.find((c) => c.kind === "resolution") ?? commitments[0];
}

/**
 * Which `BusinessCalendarVersion` a new commitment anchors to (roadmap step
 * 24): a customer-specific override, when the case's customer has one,
 * otherwise whatever the matched `SLAPolicyVersion` already specifies. Same
 * `Commitment.calendarVersionId` field and freeze-at-creation guarantee as
 * before — this only changes which version gets frozen in.
 */
export function resolveCommitmentCalendarVersion(
  policyCalendarVersion: BusinessCalendarVersion,
  customerCalendarVersion: BusinessCalendarVersion | undefined,
): BusinessCalendarVersion {
  return customerCalendarVersion ?? policyCalendarVersion;
}

export interface CommitmentPipelineResult {
  casesConsidered: number;
  commitmentsCreated: number;
  casesWithNoMatchingPolicy: number;
  casesFailed: { caseId: string; error: string }[];
}

/**
 * Creates first-response and resolution `Commitment`s for every Case in an
 * organization that doesn't have one yet, matching the Case's attributes
 * against the organization's active `SLAPolicyVersion`s (Phase 13.1). A
 * commitment, once created, is permanent — `@@unique([caseId, kind, cycleKey])`
 * with the single `SINGLE_CYCLE_KEY` enforces that a later policy edit or
 * re-run never creates a second one;
 * only an explicit future recalculation action (Phase 13.6) may replace it.
 * Safe to re-run: cases with both kinds already, or that match no policy,
 * are skipped without side effects.
 *
 * A case's commitments always share one policy and calendar version: a kind
 * still missing on a case that already has a commitment is created under
 * that commitment's frozen policy version and calendar version, never
 * re-matched against other policies. Only when that version has no target
 * for the kind (e.g. the policy gained a resolution target after the case's
 * first-response commitment was created) does it fall back to the newest
 * version of the *same* policy — still with the sibling's calendar.
 */
export interface CommitmentPipelineOptions {
  /** Policy/calendar/override reads a worker tick loaded once for all three pipelines. */
  context?: PolicyContext;
  /** Limits the run to these cases (webhook/source-sync: only the cases the delivery touched). Omit for the whole organization. */
  caseIds?: readonly string[];
}

export async function runCommitmentPipeline(
  prisma: PrismaClient,
  organizationId: string,
  options: CommitmentPipelineOptions = {},
): Promise<CommitmentPipelineResult> {
  const result: CommitmentPipelineResult = {
    casesConsidered: 0,
    commitmentsCreated: 0,
    casesWithNoMatchingPolicy: 0,
    casesFailed: [],
  };

  const { policyVersionRows, customersWithCalendarOverride } =
    options.context ?? (await loadPolicyContext(prisma, organizationId));
  if (policyVersionRows.length === 0) return result;

  const allPolicyVersions: SLAPolicyVersion[] = policyVersionRows.map(toPolicyVersionDomain);
  const policyVersionsById = new Map(
    allPolicyVersions.map((pv) => [pv.id, pv]),
  );
  const activePolicyVersions = latestVersionPerPolicy(allPolicyVersions);

  const calendarsById = new Map<string, BusinessCalendarVersion>(
    policyVersionRows.map((row) => [
      row.calendarVersion.id,
      toCalendarVersionDomain(row.calendarVersion),
    ]),
  );

  // Lazy and memoized: only resolved (and, for Always Open, possibly
  // created) the first time some matched policy actually has no explicit
  // calendar — most organizations never need it.
  let fallbackPromise: ReturnType<typeof resolveOrganizationCalendarFallback> | null = null;
  const getOrganizationCalendarFallback = () =>
    (fallbackPromise ??= resolveOrganizationCalendarFallback(prisma, organizationId));

  // 4d: frozen at the moment a customer's calendar override was set
  // (`Customer.calendarVersionId`), never the calendar's latest version —
  // consistent with how a policy pins to a specific calendar version.
  const customerCalendarVersionByCustomerId = new Map<
    string,
    BusinessCalendarVersion
  >();
  for (const customer of customersWithCalendarOverride) {
    if (!customer.calendarVersion) continue;
    customerCalendarVersionByCustomerId.set(
      customer.id,
      toCalendarVersionDomain(customer.calendarVersion),
    );
  }

  const cases = await prisma.case.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(options.caseIds ? { id: { in: [...options.caseIds] } } : {}),
      // Only cases still missing a kind (NOT EXISTS per kind) — a case with
      // both is skipped below anyway, so never loading it saves the row, its
      // JSON attributes, and the nested commitments read on every tick.
      OR: COMMITMENT_KINDS.map((kind) => ({ commitments: { none: { kind } } })),
    },
    select: {
      id: true,
      priority: true,
      customerId: true,
      tier: true,
      tags: true,
      channel: true,
      system: true,
      attributes: true,
      openedAt: true,
      // Scoped to the single-cycle kinds this pipeline creates: a persisted
      // Next Reply commitment must never be picked as the "sibling" below or
      // counted toward the calendar-version prefetch's completeness check.
      commitments: {
        where: { kind: { in: COMMITMENT_KINDS } },
        select: { kind: true, policyVersionId: true, calendarVersionId: true },
      },
    },
  });

  // D5b: agent-created tickets start their first-response clock at the first
  // customer reply, not ticket creation (`resolveFirstResponseStartedAt`).
  // Only fetched for cases that still need a first-response commitment.
  const casesNeedingFirstResponse = cases.filter((c) =>
    missingCommitmentKinds(
      c.commitments.map((cm) => cm.kind as CommitmentKind),
    ).includes("first_response"),
  );
  const firstResponseEventsByCaseId = new Map<string, NormalizedEvent[]>();
  if (casesNeedingFirstResponse.length > 0) {
    const rows = await prisma.normalizedEvent.findMany({
      where: {
        caseId: { in: casesNeedingFirstResponse.map((c) => c.id) },
        type: { in: ["case_created", "customer_replied"] },
      },
    });
    for (const row of rows) {
      const domainEvent = toNormalizedEventDomain(row);
      const bucket = firstResponseEventsByCaseId.get(domainEvent.caseId);
      if (bucket) bucket.push(domainEvent);
      else firstResponseEventsByCaseId.set(domainEvent.caseId, [domainEvent]);
    }
  }

  // Calendar versions frozen onto existing commitments that aren't already
  // loaded (e.g. a customer override that has since moved to a newer version).
  const missingCalendarVersionIds = [
    ...new Set(
      cases.flatMap((c) =>
        c.commitments.length < COMMITMENT_KINDS.length
          ? c.commitments
              .map((cm) => cm.calendarVersionId)
              .filter((id) => !calendarsById.has(id))
          : [],
      ),
    ),
  ];
  if (missingCalendarVersionIds.length > 0) {
    const rows = await prisma.businessCalendarVersion.findMany({
      where: { id: { in: missingCalendarVersionIds } },
    });
    for (const row of rows)
      calendarsById.set(row.id, toCalendarVersionDomain(row));
  }

  const commitmentsToCreate: Prisma.CommitmentCreateManyInput[] = [];

  for (const caseRow of cases) {
    result.casesConsidered += 1;
    try {
      const missingKinds = missingCommitmentKinds(
        caseRow.commitments.map((c) => c.kind as CommitmentKind),
      );
      if (missingKinds.length === 0) continue;

      const sibling = pickAnchorCommitment(caseRow.commitments);
      let policyVersionFor: (kind: CommitmentKind) => SLAPolicyVersion;
      let calendarVersion: BusinessCalendarVersion;
      if (sibling) {
        const siblingPolicyVersion = policyVersionsById.get(
          sibling.policyVersionId,
        );
        if (!siblingPolicyVersion)
          throw new Error(
            `No SLAPolicyVersion loaded for ${sibling.policyVersionId}`,
          );
        const siblingCalendarVersion = calendarsById.get(
          sibling.calendarVersionId,
        );
        if (!siblingCalendarVersion)
          throw new Error(
            `No BusinessCalendarVersion loaded for ${sibling.calendarVersionId}`,
          );
        const latestOfSamePolicy =
          activePolicyVersions.find(
            (pv) => pv.policyId === siblingPolicyVersion.policyId,
          ) ?? siblingPolicyVersion;
        policyVersionFor = (kind) =>
          siblingPolicyVersion.targets.some((t) => t.kind === kind)
            ? siblingPolicyVersion
            : latestOfSamePolicy;
        calendarVersion = siblingCalendarVersion;
      } else {
        const matched = matchPolicyVersion(
          toCaseAttributes(caseRow),
          activePolicyVersions,
        );
        if (!matched) {
          result.casesWithNoMatchingPolicy += 1;
          continue;
        }
        const frozenCalendarVersion = calendarsById.get(
          matched.calendarVersionId,
        );
        if (!frozenCalendarVersion)
          throw new Error(
            `No BusinessCalendarVersion loaded for ${matched.calendarVersionId}`,
          );
        // 4i: only a *native* policy can have no explicit calendar at all
        // (an imported one always resolves a concrete schedule or the
        // Always Open default at import time — untouched, D12/E-18). Such a
        // policy stays pinned to its frozen version; a native policy with no
        // explicit calendar re-resolves fresh to the organization's current
        // default calendar, or Always Open when it has none.
        const policyHasExplicitCalendar =
          matched.policySource !== "native" || (matched.calendarIsExplicit ?? true);
        const policyCalendarVersion = policyHasExplicitCalendar
          ? frozenCalendarVersion
          : await resolveEffectiveCalendarVersion(
              matched.calendarIsExplicit,
              frozenCalendarVersion,
              await getOrganizationCalendarFallback(),
            );
        policyVersionFor = () => matched;
        calendarVersion = resolveCommitmentCalendarVersion(
          policyCalendarVersion,
          caseRow.customerId
            ? customerCalendarVersionByCustomerId.get(caseRow.customerId)
            : undefined,
        );
      }

      for (const kind of missingKinds) {
        const policyVersion = policyVersionFor(kind);
        if (!policyVersion.targets.some((t) => t.kind === kind)) continue;

        let startedAt = caseRow.openedAt.toISOString();
        if (kind === "first_response") {
          const resolved = resolveFirstResponseStartedAt(
            firstResponseEventsByCaseId.get(caseRow.id) ?? [],
            startedAt,
          );
          // Agent-created ticket, no customer reply yet (D5b): nothing to
          // start the clock on — try again on a later run.
          if (resolved === null) continue;
          startedAt = resolved;
        }

        const commitment = createCommitment(
          caseRow.id,
          kind,
          startedAt,
          policyVersion,
          calendarVersion,
        );
        commitmentsToCreate.push({
          id: commitment.id,
          caseId: commitment.caseId,
          kind: commitment.kind,
          policyVersionId: commitment.policyVersionId,
          calendarVersionId: commitment.calendarVersionId,
          startedAt: new Date(commitment.startedAt),
          targetMinutes: commitment.targetMinutes,
          dueAt: new Date(commitment.dueAt),
          status: commitment.status,
        });
      }
    } catch (error) {
      result.casesFailed.push({
        caseId: caseRow.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // One createMany per chunk instead of a create per commitment. `id` is a
  // deterministic hash and `@@unique([caseId, kind, cycleKey])` backs it, so a
  // concurrent run (or a re-run) can't duplicate: `skipDuplicates` drops the
  // loser's row and `count` only reports what actually landed. If a batch
  // fails outright, fall back to one insert per row so a single bad case is
  // still isolated in `casesFailed` like before, instead of failing the rest.
  for (const batch of chunk(commitmentsToCreate)) {
    try {
      const created = await prisma.commitment.createMany({ data: batch, skipDuplicates: true });
      result.commitmentsCreated += created.count;
    } catch {
      for (const data of batch) {
        try {
          const created = await prisma.commitment.createMany({ data: [data], skipDuplicates: true });
          result.commitmentsCreated += created.count;
        } catch (error) {
          result.casesFailed.push({
            caseId: data.caseId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  return result;
}
