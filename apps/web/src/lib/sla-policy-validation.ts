import { COMMITMENT_KINDS, type CommitmentKind } from "@sla/core";
import type { NativePolicyMatchInput } from "@sla/commitments";

export class ValidationError extends Error {}

/** Shared by the create, update and override SLA policy routes. */
export function parseTargets(raw: unknown): { kind: CommitmentKind; minutes: number }[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError("targets must be a non-empty array");
  }
  const seenKinds = new Set<string>();
  const targets: { kind: CommitmentKind; minutes: number }[] = [];
  for (const target of raw as { kind?: unknown; minutes?: unknown }[]) {
    const kind = target?.kind;
    const minutes = target?.minutes;
    if (
      typeof kind !== "string" ||
      !COMMITMENT_KINDS.includes(kind as CommitmentKind) ||
      seenKinds.has(kind)
    ) {
      throw new ValidationError("each target must have a unique, valid kind");
    }
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes <= 0) {
      throw new ValidationError("each target's minutes must be a positive integer");
    }
    seenKinds.add(kind);
    targets.push({ kind: kind as CommitmentKind, minutes });
  }
  return targets;
}

/** No rules engine (task 4.3) — only the legacy priority/customerIds fields, never the generic conditions builder. */
export function parseMatch(raw: unknown): NativePolicyMatchInput {
  if (raw == null || typeof raw !== "object") return {};
  const value = raw as { priority?: unknown; customerIds?: unknown };
  const match: NativePolicyMatchInput = {};
  if (value.priority !== undefined) {
    if (!Array.isArray(value.priority) || value.priority.some((p) => typeof p !== "string")) {
      throw new ValidationError("match.priority must be an array of strings");
    }
    match.priority = value.priority as string[];
  }
  if (value.customerIds !== undefined) {
    if (!Array.isArray(value.customerIds) || value.customerIds.some((c) => typeof c !== "string")) {
      throw new ValidationError("match.customerIds must be an array of strings");
    }
    match.customerIds = value.customerIds as string[];
  }
  return match;
}

export function parseWarnAtPercent(raw: unknown): number[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== "number" || !Number.isInteger(p) || p <= 0 || p > 100)) {
    throw new ValidationError("warnAtPercent must be an array of integers between 1 and 100");
  }
  return raw as number[];
}
