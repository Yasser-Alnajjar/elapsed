import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@sla/db";
import { COMMITMENT_KINDS, type CommitmentKind } from "@sla/core";
import { ACTIVE_COMMITMENT_WHERE } from "./active-commitment";
import { unsupportedKindsOf } from "./sla-support";

/**
 * Existing commitments that become unsupported when a `custom` configuration
 * version is activated (N9.8a; plan 09, 5.5 and 5.6; Q14, R5, U3).
 *
 * Rules:
 * - Nothing is ever deleted. Cancellation is the only change.
 * - Only UNFINALIZED commitments of a newly unsupported kind are cancelled
 *   (`ACTIVE_COMMITMENT_WHERE`: `closedAt` null, status not `cancelled`).
 *   Finalized `met`/`breached` rows and every evaluation are untouched.
 * - A dry-run comes first and the cancellation is bound to the exact set it
 *   showed (a hash of the sorted commitment ids): a changed set voids the
 *   confirmation and needs a new preview.
 * - Idempotent: once cancelled, the same set is empty and nothing is written.
 * - A cancelled single-cycle commitment (`first_response`, `resolution`) never
 *   returns under the current pipeline, and a cancelled `next_reply` is only
 *   revived by the cycle planner when the kind is supported again, which this
 *   module's `assessActivationImpact` refuses (U3, option a).
 */
export interface KindPreview {
  total: number;
  onTrack: number;
  atRisk: number;
  /** `breached` with `closedAt` still null: cancelling it removes a breach that is still accruing. */
  breachedOpen: number;
}

export interface CancellationPreview {
  /** Newly unsupported kinds, in display order. */
  kinds: CommitmentKind[];
  total: number;
  byKind: Partial<Record<CommitmentKind, KindPreview>>;
  /** Finalized commitments of those kinds, which are kept exactly as they are. */
  keptFinalized: number;
  /** Up to 20 case ids, sorted. */
  sampleCaseIds: string[];
  /** Hash of the exact commitment-id set; the confirmation is bound to it. */
  previewHash: string;
  /** Always true: cancellation is not undone by a rollback. */
  notUndoneByRollback: true;
}

export class StaleCancellationPreviewError extends Error {
  constructor() {
    super("The commitments changed since the preview; review a new preview");
    this.name = "StaleCancellationPreviewError";
  }
}

export class NextReplyRestoreBlockedError extends Error {
  constructor() {
    super("Next Reply cannot be supported again while its commitments are cancelled from an earlier configuration");
    this.name = "NextReplyRestoreBlockedError";
  }
}

const SAMPLE_SIZE = 20;
const hashIds = (ids: readonly string[]): string => createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
const ordered = (kinds: Iterable<CommitmentKind>): CommitmentKind[] => COMMITMENT_KINDS.filter((kind) => new Set(kinds).has(kind));

type Db = Pick<PrismaClient, "commitment"> | Prisma.TransactionClient;

function scope(organizationId: string, integrationId: string, kinds: readonly CommitmentKind[]): Prisma.CommitmentWhereInput {
  return { kind: { in: [...kinds] }, case: { organizationId, sourceIntegrationId: integrationId } };
}

/** Read-only. What activating a version that makes `kinds` unsupported would cancel, and what it keeps. */
export async function previewUnsupportedKindCancellation(
  db: Db,
  input: { organizationId: string; integrationId: string; kinds: readonly CommitmentKind[] },
): Promise<CancellationPreview> {
  const kinds = ordered(input.kinds);
  const active = kinds.length
    ? await db.commitment.findMany({
        where: { ...scope(input.organizationId, input.integrationId, kinds), ...ACTIVE_COMMITMENT_WHERE },
        select: { id: true, kind: true, status: true, caseId: true },
      })
    : [];
  const byKind: Partial<Record<CommitmentKind, KindPreview>> = {};
  for (const row of active) {
    const entry = (byKind[row.kind] ??= { total: 0, onTrack: 0, atRisk: 0, breachedOpen: 0 });
    entry.total += 1;
    if (row.status === "on_track") entry.onTrack += 1;
    else if (row.status === "at_risk") entry.atRisk += 1;
    else if (row.status === "breached") entry.breachedOpen += 1;
  }
  const keptFinalized = kinds.length
    ? await db.commitment.count({
        where: { ...scope(input.organizationId, input.integrationId, kinds), closedAt: { not: null }, status: { in: ["met", "breached"] } },
      })
    : 0;
  return {
    kinds,
    total: active.length,
    byKind,
    keptFinalized,
    sampleCaseIds: [...new Set(active.map((row) => row.caseId))].sort().slice(0, SAMPLE_SIZE),
    previewHash: hashIds(active.map((row) => row.id)),
    notUndoneByRollback: true,
  };
}

/**
 * Cancels the previewed set inside the caller's transaction (version
 * activation and cancellation commit together or not at all). Rejects with
 * `StaleCancellationPreviewError` when the set no longer matches
 * `expectedHash`. Stamps `closedAt` as the Next Reply planner does.
 */
export async function cancelUnsupportedKindCommitments(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; integrationId: string; kinds: readonly CommitmentKind[]; expectedHash: string; now: Date },
): Promise<{ cancelled: number; previewHash: string; byKind: Partial<Record<CommitmentKind, number>> }> {
  const kinds = ordered(input.kinds);
  const rows = kinds.length
    ? await tx.commitment.findMany({
        where: { ...scope(input.organizationId, input.integrationId, kinds), ...ACTIVE_COMMITMENT_WHERE },
        select: { id: true, kind: true },
      })
    : [];
  const previewHash = hashIds(rows.map((row) => row.id));
  if (previewHash !== input.expectedHash) throw new StaleCancellationPreviewError();
  const byKind: Partial<Record<CommitmentKind, number>> = {};
  for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  if (rows.length === 0) return { cancelled: 0, previewHash, byKind };
  const { count } = await tx.commitment.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, ...ACTIVE_COMMITMENT_WHERE },
    data: { status: "cancelled", closedAt: input.now },
  });
  return { cancelled: count, previewHash, byKind };
}

export interface ActivationImpact {
  /** Kinds the target version makes unsupported that the integration supports today. */
  newlyUnsupportedKinds: CommitmentKind[];
  /** Kinds the target version supports that the integration does not support today. */
  resupportedKinds: CommitmentKind[];
  /** Present when `newlyUnsupportedKinds` is non-empty. */
  cancellation: CancellationPreview | null;
  /** Cancelled commitments of re-supported kinds: they will not return (R5). */
  remainsCancelled: Partial<Record<CommitmentKind, number>>;
  /** Set when activation must be refused (U3, option a). */
  blocked: "next_reply_restore_blocked" | null;
}

/**
 * Read-only assessment of activating (or rolling back to) a version whose
 * `slaSupport` is `target`, for an integration whose current value is
 * `current`. A first activation (no integration, no commitments) has none of
 * these effects. Refuses re-supporting `next_reply` while any `next_reply`
 * commitment of the integration is cancelled, because the cycle planner would
 * silently revive it with its old clock (plan 09, 5.6).
 */
export async function assessActivationImpact(
  db: Db,
  input: { organizationId: string; integrationId: string | null; current: unknown; target: unknown },
): Promise<ActivationImpact> {
  const current = unsupportedKindsOf(input.current);
  const target = unsupportedKindsOf(input.target);
  const newlyUnsupportedKinds = ordered([...target].filter((kind) => !current.has(kind)));
  const resupportedKinds = ordered([...current].filter((kind) => !target.has(kind)));
  if (!input.integrationId) {
    return { newlyUnsupportedKinds, resupportedKinds: [], cancellation: null, remainsCancelled: {}, blocked: null };
  }
  const cancellation = newlyUnsupportedKinds.length
    ? await previewUnsupportedKindCancellation(db, { organizationId: input.organizationId, integrationId: input.integrationId, kinds: newlyUnsupportedKinds })
    : null;

  const remainsCancelled: Partial<Record<CommitmentKind, number>> = {};
  for (const kind of resupportedKinds) {
    const count = await db.commitment.count({ where: { ...scope(input.organizationId, input.integrationId, [kind]), status: "cancelled" } });
    if (count > 0) remainsCancelled[kind] = count;
  }
  const blocked = resupportedKinds.includes("next_reply") && (remainsCancelled.next_reply ?? 0) > 0 ? "next_reply_restore_blocked" : null;
  return { newlyUnsupportedKinds, resupportedKinds, cancellation, remainsCancelled, blocked };
}
