import type { Prisma, PrismaClient } from "@sla/db";
import {
  PolicyCondition,
  PolicyConditionGroup,
  policyVersionContentEquals,
  type CommitmentKind,
  type NormalizedState,
  type SLAPolicyMatch,
} from "@sla/core";
import { DEFAULT_CALENDAR_NAME, ensureDefaultCalendarVersion } from "@sla/commitments";
import { latestCalendarVersionsByZendeskScheduleId } from "./calendars";
import { latestSnapshotById } from "./normalize";
import type { SlaPolicyManifest } from "./rawEvents";
import type {
  ZendeskSlaPolicy,
  ZendeskSlaPolicyCondition,
  ZendeskSlaPolicyFilter,
  ZendeskSlaPolicyMetric,
} from "./types";

/**
 * Zendesk SLA metric name -> the CommitmentKind packages/core knows how to
 * track. Zendesk's API names the resolution metric `total_resolution_time`
 * (admin center: "Total resolution time"); `resolution_time` is kept for
 * snapshots that use the shorter name. `next_reply_time` maps to `next_reply`
 * (Step 8) — the per-cycle target `runNextReplyCyclePipeline` freezes onto
 * each cycle's Commitment. Every other Zendesk metric (requester_wait_time,
 * agent_work_time, periodic_update_time, pausable_update_time) has no
 * equivalent and is dropped.
 */
const METRIC_TO_COMMITMENT_KIND: Record<string, CommitmentKind> = {
  first_reply_time: "first_response",
  total_resolution_time: "resolution",
  resolution_time: "resolution",
  next_reply_time: "next_reply",
};

/** Copies a Zendesk filter condition's field/operator/value as-is — every field is preserved (see `extractMatchFromFilter`), not just ones this system can resolve to a case attribute. */
function normalizeCondition(
  condition: ZendeskSlaPolicyCondition,
): PolicyCondition {
  return {
    field: condition.field,
    operator: condition.operator,
    value: condition.value,
  };
}

/**
 * Every Zendesk SLA condition `field` this importer resolves onto a Case's
 * canonical columns or its generic `attributes` bag (see
 * `zendeskConditionAttributes`, ./normalize.ts, and the field mapping table
 * on `ZendeskSlaPolicyCondition`, ./types.ts) — everything else is preserved
 * in the match (never dropped, `normalizeCondition` above) but is reported
 * as unsupported, since it can never actually be satisfied (see
 * `unsupportedConditions` below and `evaluateCondition`, packages/core).
 * `organization_id` is deliberately not listed here — it's resolved through
 * an entirely different path (`match.customerIds`, not a generic attribute)
 * and is handled/counted separately below.
 */
const RESOLVED_CONDITION_FIELDS = new Set([
  "tags",
  "current_tags",
  "priority",
  "status",
  "type",
  "group_id",
  "assignee_id",
  "requester_id",
  "via_id",
  "current_via_id",
  "brand_id",
  "ticket_form_id",
  "form_id",
  "recipient",
  "exact_created_at",
]);

const CUSTOM_FIELD_CONDITION = /^custom_fields_\d+$/;

function isResolvedConditionField(field: string): boolean {
  return (
    RESOLVED_CONDITION_FIELDS.has(field) || CUSTOM_FIELD_CONDITION.test(field)
  );
}
/**
 * Imported Zendesk policies never pause Resolution (H-12, 2026-09-29): Zendesk
 * itself does not. The H-4 spot check found no `pause` event on Zendesk's
 * `resolution_time` for any Pending interval, and its `breach` event lands
 * exactly at start + target even when the ticket sat in Pending first. An
 * imported policy mirrors its source, so Elapsed's breach times and elapsed
 * numbers must match the ones customers see in Zendesk. (Solved intervals are
 * still excluded from Resolution by `clock-rules.ts` (D3), as Zendesk does.)
 * Native policies are unaffected: they default to pausing on
 * `pending_customer` (`native-policy.ts`).
 */
export const IMPORTED_PAUSE_ON_STATES: NormalizedState[] = [];
export const WARN_AT_PERCENT = [50, 80, 95];

// `ensureDefaultCalendarVersion`/`DEFAULT_CALENDAR_NAME` now live in
// @sla/commitments (4i: native policy resolution needs them too, for an org
// that never connected a ticket source) — re-exported here unchanged for
// this module's existing callers/tests.
export { DEFAULT_CALENDAR_NAME, ensureDefaultCalendarVersion };

export interface ExtractedMatch {
  match: SLAPolicyMatch;
  /** Conditions present in the filter that couldn't be represented — reported so import coverage is honest, never silently dropped. */
  unsupportedConditions: number;
}

function conditionValues(
  conditions: ZendeskSlaPolicyCondition[],
  field: string,
): string[] {
  return conditions
    .filter((c) => c.field === field && c.value != null)
    .map((c) => String(c.value).toLowerCase());
}

/**
 * Flattens a Zendesk SLA policy's `filter` into packages/core's
 * `SLAPolicyMatch`. `all` and `any` conditions on the same field are folded
 * into one OR-set for that field — exact for the common case (a single
 * "priority is X" or "priority is X OR Y" condition), but a filter that ORs
 * across *different* fields cannot be represented by our AND-across-
 * dimensions match model and will end up matching more broadly than
 * Zendesk's own evaluation. Organization conditions are translated to our
 * internal Customer ids via the Zendesk org id already recorded on Customer
 * (roadmap step 3) — an org with no Customer yet (never seen on a ticket)
 * cannot be resolved. This must never fall back to "no organization
 * restriction" (E-7): a filter that named at least one `organization_id`
 * condition sets `match.customerIds` to an explicit empty array when none of
 * those orgs resolve to a known Customer, which `matchPolicyVersion`
 * (packages/core) treats as "matches no case" rather than "unrestricted".
 *
 * `organization_id` conditions are translated into `match.customerIds` and
 * then dropped from the generic `conditions.all`/`any` groups entirely —
 * never duplicated into both. A case's attributes only ever carry its
 * resolved `customerId`, never a raw `organization_id`, so an `organization_id`
 * left in the generic group would always evaluate as "field missing" (see
 * `evaluateCondition`, packages/core) and make the *whole* policy fail to
 * match every case, silently overriding the working `customerIds` check
 * (this was a real bug: D6-fixed).
 */
export interface ExtractedMatch {
  match: SLAPolicyMatch;
  unsupportedConditions: number;
}

export function extractMatchFromFilter(
  filter: ZendeskSlaPolicyFilter | undefined,
  customerIdsByZendeskOrgId: ReadonlyMap<string, string>,
): ExtractedMatch {
  const all = (filter?.all ?? []).map(normalizeCondition);
  const any = (filter?.any ?? []).map(normalizeCondition);
  if (!filter) {
    return {
      match: {},
      unsupportedConditions: 0,
    };
  }
  const organizationConditions = [...all, ...any].filter(
    (condition) => condition.field === "organization_id",
  );

  const customerIds = new Set(
    organizationConditions
      .map((condition) => String(condition.value))
      .map((zendeskOrgId) => customerIdsByZendeskOrgId.get(zendeskOrgId))
      .filter((id): id is string => id != null),
  );

  const genericAll = all.filter(
    (condition) => condition.field !== "organization_id",
  );
  const genericAny = any.filter(
    (condition) => condition.field !== "organization_id",
  );

  const conditions: PolicyConditionGroup = {};

  if (genericAll.length > 0) {
    conditions.all = genericAll;
  }

  if (genericAny.length > 0) {
    conditions.any = genericAny;
  }

  const match: SLAPolicyMatch = {
    conditions,
  };

  /*
   * Keep the legacy normalized organization field because existing
   * matching/data/tests may still depend on it.
   */
  if (customerIds.size > 0) {
    match.customerIds = [...customerIds];
  } else if (organizationConditions.length > 0) {
    match.customerIds = [];
  }

  // The condition itself is still preserved in `match.conditions` above
  // (never dropped) — this only counts how many of them name a field this
  // importer can't resolve onto any Case attribute, so it can never actually
  // be satisfied (`evaluateCondition`, packages/core, fails it safe as
  // "field missing"). `organization_id` is resolved through `customerIds`
  // above, not this generic path, so it's never counted here.
  const unsupportedConditions = [...genericAll, ...genericAny].filter(
    (condition) => !isResolvedConditionField(condition.field),
  ).length;

  return {
    match,
    unsupportedConditions,
  };
}

export interface PolicyTargetGroup {
  /** Ticket priority this group of targets applies to, or null when it applies regardless of priority. */
  priority: string | null;
  targets: { kind: CommitmentKind; minutes: number }[];
}

export interface GroupedPolicyMetrics {
  groups: PolicyTargetGroup[];
  /** Metrics whose Zendesk name has no CommitmentKind equivalent — reported, not silently dropped. */
  unsupportedMetrics: number;
}

/**
 * Groups a Zendesk SLA policy's `policy_metrics` by the priority tier they
 * apply to. Each group becomes a separate `SLAPolicy` identity in our
 * schema (see `runZendeskSlaPolicyImport`), since one `SLAPolicyVersion`
 * carries a single `targets` array and Zendesk lets one policy define
 * different first-reply/resolution targets per priority.
 */
export function groupPolicyMetricsByPriority(
  metrics: ZendeskSlaPolicyMetric[] | undefined,
): GroupedPolicyMetrics {
  const byPriority = new Map<
    string | null,
    { kind: CommitmentKind; minutes: number }[]
  >();
  let unsupportedMetrics = 0;

  for (const metric of metrics ?? []) {
    const kind = METRIC_TO_COMMITMENT_KIND[metric.metric];
    if (!kind) {
      unsupportedMetrics += 1;
      continue;
    }
    const priority = metric.priority ? metric.priority.toLowerCase() : null;
    const targets = byPriority.get(priority) ?? [];
    targets.push({ kind, minutes: metric.target });
    byPriority.set(priority, targets);
  }

  const groups = [...byPriority.entries()].map(([priority, targets]) => ({
    priority,
    targets,
  }));
  return { groups, unsupportedMetrics };
}

interface PolicyVersionContent {
  match: SLAPolicyMatch;
  targets: { kind: CommitmentKind; minutes: number }[];
  calendarVersionId: string;
}

export { policyVersionContentEquals };

/**
 * Which `BusinessCalendarVersion` a policy's commitments should anchor to.
 * A policy with `schedule_id` set points at a specific Zendesk business
 * hours schedule; if that schedule has been imported (roadmap step 13) its
 * calendar is used, otherwise the policy falls back to the always-open
 * default and the gap is counted, never guessed at. A policy with no
 * `schedule_id` (calendar-time metrics, or an account with no selectable
 * schedule) also uses the default.
 */
export function resolvePolicyCalendarVersion(
  policy: ZendeskSlaPolicy,
  calendarVersionsByScheduleId: ReadonlyMap<number, { id: string }>,
  defaultCalendarVersion: { id: string },
): { calendarVersionId: string; scheduleUnresolved: boolean } {
  if (policy.schedule_id == null) {
    return {
      calendarVersionId: defaultCalendarVersion.id,
      scheduleUnresolved: false,
    };
  }
  const resolved = calendarVersionsByScheduleId.get(policy.schedule_id);
  if (resolved) {
    return { calendarVersionId: resolved.id, scheduleUnresolved: false };
  }
  return {
    calendarVersionId: defaultCalendarVersion.id,
    scheduleUnresolved: true,
  };
}

/**
 * Appends an `imported` version when Zendesk's policy content differs from
 * the last one we imported. Compares against the latest *imported* version,
 * not the latest version: a manual override (`source: "override"`, roadmap
 * step 19) sits on top of an imported version, and comparing Zendesk's
 * unchanged targets against the override would revert it on the next sync.
 * A real change on the Zendesk side still creates a new imported version,
 * which supersedes any override made against the old one.
 */
export async function upsertPolicyVersion(
  prisma: PrismaClient,
  organizationId: string,
  externalId: string,
  name: string,
  desired: PolicyVersionContent,
  position: number | null = null,
): Promise<boolean> {
  // If this externalId was previously archived (its Zendesk policy was
  // deleted, or believed to be — E-9) and has since reappeared in a live
  // Zendesk listing, un-archive it here: reaching this point at all means
  // the caller (`runZendeskSlaPolicyImport`) already confirmed the id is in
  // the current live manifest, so a still-archived row here would otherwise
  // stay permanently excluded from matching even though it's live again.
  const policy = await prisma.sLAPolicy.upsert({
    where: { organizationId_externalId: { organizationId, externalId } },
    // `sourceProvider` scopes the policy to Zendesk cases (N1.11); set on
    // update too, so a row written before the column existed heals on the
    // next import instead of staying unscoped.
    update: { name, position, archivedAt: null, sourceProvider: "zendesk" },
    create: { organizationId, externalId, name, position, source: "imported", sourceProvider: "zendesk" },
  });

  const [latestVersion, latestImportedVersion] = await Promise.all([
    prisma.sLAPolicyVersion.findFirst({
      where: { policyId: policy.id },
      orderBy: { version: "desc" },
    }),
    prisma.sLAPolicyVersion.findFirst({
      where: { policyId: policy.id, source: "imported" },
      orderBy: { version: "desc" },
    }),
  ]);

  if (
    latestImportedVersion &&
    policyVersionContentEquals(
      {
        match: latestImportedVersion.match as SLAPolicyMatch,
        targets: latestImportedVersion.targets as {
          kind: CommitmentKind;
          minutes: number;
        }[],
        calendarVersionId: latestImportedVersion.calendarVersionId,
      },
      desired,
    )
  ) {
    return false;
  }

  await prisma.sLAPolicyVersion.create({
    data: {
      policyId: policy.id,
      version: (latestVersion?.version ?? 0) + 1,
      match: desired.match as unknown as Prisma.InputJsonValue,
      targets: desired.targets as unknown as Prisma.InputJsonValue,
      pauseOnStates: IMPORTED_PAUSE_ON_STATES,
      calendarVersionId: desired.calendarVersionId,
      warnAtPercent: WARN_AT_PERCENT,
      effectiveFrom: new Date(),
      source: "imported",
    },
  });
  return true;
}

export interface SlaPolicyImportResult {
  policiesEvaluated: number;
  policyVersionsCreated: number;
  unsupportedConditions: number;
  unsupportedMetrics: number;
  policiesWithNoUsableTargets: number;
  /** Policies whose `schedule_id` points at a schedule not (yet) imported as a BusinessCalendar — fell back to the always-open default. */
  policiesWithUnresolvedSchedule: number;
  /** Previously-imported policies archived because they no longer appear in the latest Zendesk sla_policies listing (E-9). */
  policiesArchived: number;
}

/**
 * `RawEvent` (sla_policy snapshots) -> `SLAPolicy`/`SLAPolicyVersion`
 * (Phase 10: "imported from Zendesk first, editable second"). Idempotent:
 * re-running only creates a new version when a policy's match or targets
 * actually changed since the last import, so a manual override survives
 * until then. No fuzzy matching — a filter condition or metric this
 * importer doesn't understand is dropped and counted, never guessed at.
 *
 * Also archives (`SLAPolicy.archivedAt`) any previously-imported policy
 * absent from the latest full sla_policies listing — deleted/deactivated in
 * Zendesk (E-9). Archived policies are excluded from this and future
 * imports' matching (`packages/commitments`'s pipeline/cycle-pipeline/
 * re-resolution queries all filter `archivedAt: null`), but their versions
 * and any commitments already frozen onto them are untouched.
 */
export async function runZendeskSlaPolicyImport(
  prisma: PrismaClient,
  integrationId: string,
): Promise<SlaPolicyImportResult> {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  const organizationId = integration.organizationId;

  const result: SlaPolicyImportResult = {
    policiesEvaluated: 0,
    policyVersionsCreated: 0,
    unsupportedConditions: 0,
    unsupportedMetrics: 0,
    policiesWithNoUsableTargets: 0,
    policiesWithUnresolvedSchedule: 0,
    policiesArchived: 0,
  };

  const rows = await prisma.rawEvent.findMany({
    where: { integrationId, providerEventId: { startsWith: "sla_policy:" } },
    select: { id: true, payload: true, fetchedAt: true },
    orderBy: { fetchedAt: "asc" },
  });
  const latestPolicies = latestSnapshotById<ZendeskSlaPolicy>(rows);

  // The most recent full sla_policies listing (see backfillSlaPolicies /
  // mapSlaPolicyManifestToRawEvent) — absent for an integration that hasn't
  // run the manifest-writing backfill yet, in which case every known
  // snapshot is still processed and nothing is archived (unchanged prior
  // behavior).
  const manifestRow = await prisma.rawEvent.findFirst({
    where: {
      integrationId,
      providerEventId: { startsWith: "sla_policy_manifest:" },
    },
    select: { payload: true },
    orderBy: { fetchedAt: "desc" },
  });
  const liveZendeskIds = manifestRow
    ? new Set((manifestRow.payload as unknown as SlaPolicyManifest).policyIds)
    : null;

  if (liveZendeskIds) {
    // `source: "imported"` (Phase 4 / D12) is the explicit, first-class
    // signal for "this reconciliation must never touch it otherwise" — kept
    // alongside `externalId: { not: null }` (the two are always in sync: a
    // native policy always has a null externalId) as a defensive, explicit
    // guarantee that this reconciliation can never archive a native policy,
    // which is managed entirely by Watchtower and never present in Zendesk.
    const importedPolicies = await prisma.sLAPolicy.findMany({
      where: { organizationId, source: "imported", externalId: { not: null }, archivedAt: null },
      select: { id: true, externalId: true },
    });
    const toArchive = importedPolicies.filter(
      (p) => !liveZendeskIds.has(Number(p.externalId!.split(":")[0])),
    );
    if (toArchive.length > 0) {
      await prisma.sLAPolicy.updateMany({
        where: { id: { in: toArchive.map((p) => p.id) } },
        data: { archivedAt: new Date() },
      });
    }
    result.policiesArchived = toArchive.length;
  }

  if (latestPolicies.size === 0) return result;

  const customers = await prisma.customer.findMany({
    where: { organizationId, zendeskOrgId: { not: null } },
    select: { id: true, zendeskOrgId: true },
  });
  const customerIdsByZendeskOrgId = new Map(
    customers.map((c) => [c.zendeskOrgId as string, c.id]),
  );

  const defaultCalendarVersion = await ensureDefaultCalendarVersion(
    prisma,
    organizationId,
  );
  const calendarVersionsByScheduleId =
    await latestCalendarVersionsByZendeskScheduleId(prisma, organizationId);

  const policyEntries = liveZendeskIds
    ? [...latestPolicies.values()].filter(({ value }) =>
        liveZendeskIds.has(value.id),
      )
    : [...latestPolicies.values()];

  for (const { value: policy } of policyEntries) {
    result.policiesEvaluated += 1;

    const { match: filterMatch, unsupportedConditions } =
      extractMatchFromFilter(policy.filter, customerIdsByZendeskOrgId);
    result.unsupportedConditions += unsupportedConditions;

    const { groups, unsupportedMetrics } = groupPolicyMetricsByPriority(
      policy.policy_metrics,
    );
    result.unsupportedMetrics += unsupportedMetrics;

    if (groups.length === 0) {
      result.policiesWithNoUsableTargets += 1;
      continue;
    }

    const { calendarVersionId, scheduleUnresolved } =
      resolvePolicyCalendarVersion(
        policy,
        calendarVersionsByScheduleId,
        defaultCalendarVersion,
      );
    if (scheduleUnresolved) result.policiesWithUnresolvedSchedule += 1;

    for (const group of groups) {
      const externalId = `${policy.id}:${group.priority ?? "any"}`;
      const match = withMetricPriority(filterMatch, group.priority);
      if (group.priority) match.priority = [group.priority];

      const created = await upsertPolicyVersion(
        prisma,
        organizationId,
        externalId,
        policy.title,
        { match, targets: group.targets, calendarVersionId },
        policy.position ?? null,
      );
      if (created) result.policyVersionsCreated += 1;
    }
  }

  return result;
}
function withMetricPriority(
  match: SLAPolicyMatch,
  priority: string | null,
): SLAPolicyMatch {
  if (!priority) {
    return match;
  }

  return {
    ...match,
    priority: [priority],
    conditions: {
      ...match.conditions,
      all: [
        ...(match.conditions?.all ?? []),
        {
          field: "priority",
          operator: "is",
          value: priority,
        },
      ],
    },
  };
}
