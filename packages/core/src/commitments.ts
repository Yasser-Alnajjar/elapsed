import { randomUUID } from "node:crypto";
import { computeDeadline } from "./calendar";
import type {
  BusinessCalendarVersion,
  CanonicalPriority,
  CaseAttributes,
  Commitment,
  CommitmentKind,
  PolicyCondition,
  PolicyConditionGroup,
  SLAPolicyVersion,
} from "./types";
import { SINGLE_CYCLE_KEY } from "./types";

/**
 * A rough count of how restrictive a match is, used to rank same-position
 * (or unpositioned) candidates — every legacy field (priority/customerIds/
 * tier) counts for one, and every generic condition counts too, so a
 * Zendesk-imported policy whose `filter` only ever produces `match.conditions`
 * (see `extractMatchFromFilter`, packages/zendesk) still outranks an
 * unconditioned catch-all instead of tying with it. An `any` group counts
 * once regardless of its size — it's an OR, so it's never more restrictive
 * than a second `all` condition would be.
 */
function specificity(match: SLAPolicyVersion["match"]): number {
  return (
    (match.priority?.length ? 1 : 0) +
    (match.customerIds?.length ? 1 : 0) +
    (match.tier?.length ? 1 : 0) +
    (match.conditions?.all?.length ?? 0) +
    (match.conditions?.any?.length ? 1 : 0)
  );
}
function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some((value) => valuesEqual(value, expected));
  }

  if (actual == null || expected == null) {
    return actual === expected;
  }

  return (
    String(actual).trim().toLowerCase() ===
    String(expected).trim().toLowerCase()
  );
}

/**
 * Zendesk's `includes`/`not_includes` operator on a list-valued field (e.g.
 * `current_tags`) takes a *space-delimited list* of values to compare
 * against, matched as "at least one of these" — not a single literal value.
 * A single-token `expected` behaves exactly as before (one token, "any of
 * one" is just "equals one of").
 */
function includesValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    if (typeof expected === "string" && expected.trim().includes(" ")) {
      return expected
        .trim()
        .split(/\s+/)
        .some((token) => actual.some((value) => valuesEqual(value, token)));
    }
    return actual.some((value) => valuesEqual(value, expected));
  }

  if (typeof actual === "string") {
    return actual.toLowerCase().includes(String(expected).toLowerCase());
  }

  return false;
}

/** The ordering of Elapsed's own priority vocabulary (`CanonicalPriority`) — the only field whose `less_than`/`greater_than` comparison isn't a plain numeric/date compare. */
const PRIORITY_ORDER: Record<CanonicalPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/**
 * Orders `actual` relative to `expected` for `less_than`/`greater_than`
 * comparisons, or `null` when the two values can't be meaningfully compared
 * (an unrecognized priority string, non-numeric/non-date text, ...) — the
 * caller then fails the condition rather than guessing, same policy as an
 * unknown operator.
 */
function compareOrdinal(
  field: string,
  actual: unknown,
  expected: unknown,
): number | null {
  if (field === "priority") {
    const a = PRIORITY_ORDER[String(actual).toLowerCase() as CanonicalPriority] as number | undefined;
    const b = PRIORITY_ORDER[String(expected).toLowerCase() as CanonicalPriority] as number | undefined;
    return a === undefined || b === undefined ? null : a - b;
  }

  const aDate = Date.parse(String(actual));
  const bDate = Date.parse(String(expected));
  if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) return aDate - bDate;

  const aNum = Number(actual);
  const bNum = Number(expected);
  if (actual !== "" && expected !== "" && !Number.isNaN(aNum) && !Number.isNaN(bNum)) {
    return aNum - bNum;
  }

  return null;
}

function evaluateCondition(
  attributes: Record<string, unknown>,
  condition: PolicyCondition,
): boolean {
  const actual = attributes[condition.field];

  // Presence operators are the only ones a missing field can satisfy —
  // every other operator below requires a value to compare against.
  if (condition.operator === "present") {
    return actual !== undefined && actual !== null;
  }
  if (condition.operator === "not_present") {
    return actual === undefined || actual === null;
  }

  // Missing fields must never satisfy a value-comparison condition.
  if (actual === undefined || actual === null) {
    return false;
  }

  switch (condition.operator) {
    case "is":
    case "equals":
      return valuesEqual(actual, condition.value);

    case "includes":
    case "contains":
      return includesValue(actual, condition.value);

    case "is_not":
    case "not_equals":
      return !valuesEqual(actual, condition.value);

    case "not_includes":
    case "not_contains":
      return !includesValue(actual, condition.value);

    case "less_than": {
      const cmp = compareOrdinal(condition.field, actual, condition.value);
      return cmp !== null && cmp < 0;
    }

    case "less_than_equal": {
      const cmp = compareOrdinal(condition.field, actual, condition.value);
      return cmp !== null && cmp <= 0;
    }

    case "greater_than": {
      const cmp = compareOrdinal(condition.field, actual, condition.value);
      return cmp !== null && cmp > 0;
    }

    case "greater_than_equal": {
      const cmp = compareOrdinal(condition.field, actual, condition.value);
      return cmp !== null && cmp >= 0;
    }

    default:
      // Never broaden a policy because we do not understand an operator.
      return false;
  }
}

function matchesGenericConditions(
  attributes: Record<string, unknown>,
  conditions: PolicyConditionGroup,
): boolean {
  if (
    conditions.all?.some(
      (condition) => !evaluateCondition(attributes, condition),
    )
  ) {
    return false;
  }

  if (
    conditions.any &&
    conditions.any.length > 0 &&
    !conditions.any.some((condition) =>
      evaluateCondition(attributes, condition),
    )
  ) {
    return false;
  }

  return true;
}
function matches(
  caseAttributes: CaseAttributes,
  policyVersion: SLAPolicyVersion,
): boolean {
  const { match } = policyVersion;

  const attributes: Record<string, unknown> = {
    ...caseAttributes.attributes,
    ...(caseAttributes.priority !== undefined
      ? { priority: caseAttributes.priority }
      : {}),
    ...(caseAttributes.customerId !== undefined
      ? { customerId: caseAttributes.customerId }
      : {}),
    ...(caseAttributes.tier !== undefined ? { tier: caseAttributes.tier } : {}),
  };

  if (
    match.conditions &&
    !matchesGenericConditions(attributes, match.conditions)
  ) {
    return false;
  }

  if (
    match.priority &&
    (!caseAttributes.priority ||
      !match.priority.includes(caseAttributes.priority))
  ) {
    return false;
  }

  if (
    match.customerIds &&
    (!caseAttributes.customerId ||
      !match.customerIds.includes(caseAttributes.customerId))
  ) {
    return false;
  }

  if (
    match.tier &&
    (!caseAttributes.tier || !match.tier.includes(caseAttributes.tier))
  ) {
    return false;
  }

  return true;
}
/**
 * Matches a Case's attributes against active policy versions.
 *
 * Imported policies always match before native ones (D12/Phase 4) —
 * `policySource` absent or `"imported"` outranks `"native"` — since an
 * imported policy is read-only, Zendesk-driven, and considered
 * authoritative; a native policy only ever fills a gap Zendesk leaves.
 *
 * Within the imported bucket, policies are ranked by their Zendesk
 * `position` (D6/1.10: lower position wins, matching Zendesk's own
 * evaluation order) — a version with a `policyPosition` always outranks one
 * without, regardless of specificity, since a position is Zendesk's
 * explicit, authoritative ordering. Versions that share a position (fanned
 * out per priority group from one Zendesk policy,
 * `groupPolicyMetricsByPriority` in packages/zendesk) and versions with no
 * position at all (an import from before `position` existed) fall back to
 * specificity, same as the native bucket: a policy version with more
 * defined match criteria outranks one with fewer, provided all of its
 * defined criteria are satisfied. Ties break on the higher version number,
 * then on `id` for full determinism.
 */
export function matchPolicyVersion(
  caseAttributes: CaseAttributes,
  activePolicyVersions: SLAPolicyVersion[],
): SLAPolicyVersion | null {
  const candidates = activePolicyVersions.filter((pv) =>
    matches(caseAttributes, pv),
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aNative = a.policySource === "native";
    const bNative = b.policySource === "native";
    if (aNative !== bNative) return aNative ? 1 : -1;

    const aPos = a.policyPosition ?? null;
    const bPos = b.policyPosition ?? null;
    if (aPos !== null || bPos !== null) {
      if (aPos === null) return 1;
      if (bPos === null) return -1;
      if (aPos !== bPos) return aPos - bPos;
    }
    const specificityDelta = specificity(b.match) - specificity(a.match);
    if (specificityDelta !== 0) return specificityDelta;
    const versionDelta = b.version - a.version;
    if (versionDelta !== 0) return versionDelta;
    return a.id.localeCompare(b.id);
  });

  return candidates[0]!;
}

/**
 * Whether an active Commitment's policy/target needs to change to match
 * `matchedPolicyVersion` — the currently applicable policy version for the
 * commitment's case, from a fresh `matchPolicyVersion` call (Active-Commitment
 * Re-Resolution).
 *
 * `changed` compares the underlying **policy** (`policyId`), not the specific
 * version (`id`) — decision D1. A new version of the *same* policy (a manual
 * override, a Zendesk re-import, or an edit in the policy UI) never
 * re-resolves an active commitment; only a case attribute (priority,
 * customer/organization, tier, or any future match-driving attribute)
 * changing enough that a genuinely *different* policy now matches does.
 * Deliberately generic: it never inspects which `CaseAttributes` field moved,
 * so every such attribute is handled through the same path. A calendar
 * change alone (D1b) never reaches this function at all — it doesn't affect
 * `matchPolicyVersion`'s result, so `changed` stays false and the caller
 * never recomputes `calendarVersionId` for an otherwise-unchanged commitment.
 *
 * `hasTarget` is false when `matchedPolicyVersion` has no target for the
 * commitment's `kind` (e.g. the newly-applicable policy dropped `next_reply`)
 * — the caller must leave the commitment's policy/target untouched in that
 * case rather than null it out or replace the commitment, since a
 * misconfigured newly-matched policy is not a reason to destroy an active
 * SLA commitment.
 */
export interface CommitmentPolicyResolution {
  /** True when `matchedPolicyVersion.policyId` differs from the commitment's current policy's id — a switch to a different policy, not merely a new version of the same one. */
  changed: boolean;
  /** False when `matchedPolicyVersion` has no target for the commitment's `kind`. */
  hasTarget: boolean;
}

export function resolveCommitmentPolicyChange(
  commitment: Pick<Commitment, "kind">,
  currentPolicyId: string,
  matchedPolicyVersion: SLAPolicyVersion,
): CommitmentPolicyResolution {
  return {
    changed: matchedPolicyVersion.policyId !== currentPolicyId,
    hasTarget: matchedPolicyVersion.targets.some(
      (t) => t.kind === commitment.kind,
    ),
  };
}

/**
 * Creates a Commitment for a Case under a specific policy and calendar
 * version, freezing both ids onto the result permanently (Phase 13.1).
 * Later edits to the policy or calendar create new versions and never
 * retroactively affect this commitment. `cycleKey` defaults to
 * `SINGLE_CYCLE_KEY`; a Next Reply commitment passes its cycle's key.
 *
 * "Permanently" means for the lifetime of this exact policy match: while the
 * commitment is still active (unfinalized, uncancelled), Active-Commitment
 * Re-Resolution may update `policyVersionId`/`targetMinutes`/
 * `calendarVersionId`/`dueAt` in place if the Case's attributes change enough
 * that a different policy version now applies — `startedAt`, `cycleKey`, and
 * the commitment's identity never change. A finalized or cancelled commitment
 * is never touched by re-resolution, so "permanent" still holds once a
 * commitment is done. See `resolveCommitmentPolicyChange` and
 * `runCommitmentReResolutionPipeline` (packages/commitments).
 */
export function createCommitment(
  caseId: string,
  kind: CommitmentKind,
  startedAt: string,
  policyVersion: SLAPolicyVersion,
  calendarVersion: BusinessCalendarVersion,
  cycleKey: string = SINGLE_CYCLE_KEY,
): Commitment {
  const target = policyVersion.targets.find((t) => t.kind === kind);
  if (!target) {
    throw new Error(
      `Policy version ${policyVersion.id} has no target for commitment kind "${kind}"`,
    );
  }

  const dueAt = computeDeadline(startedAt, target.minutes, calendarVersion);

  return {
    id: randomUUID(),
    caseId,
    kind,
    cycleKey,
    policyVersionId: policyVersion.id,
    calendarVersionId: calendarVersion.id,
    startedAt,
    targetMinutes: target.minutes,
    dueAt: dueAt.toISOString(),
    status: "on_track",
  };
}
