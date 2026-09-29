import { getPrismaClient, type PrismaClient } from "@sla/db";
import { resolveFirstResponseStartedAt } from "@sla/core";
import { toNormalizedEventDomain } from "../evaluate-pipeline";

/**
 * H-11 repair: before the creation-actor fix, `case_created.actor` flipped as
 * audits arrived, so a first-response commitment could be created with a start
 * that disagrees with the rule (D5b) — a clock opened at creation on an
 * agent-submitted ticket with no customer reply (a false breach), or started
 * at the wrong instant. `runCommitmentPipeline` only creates *missing*
 * commitments and never rewrites one, so those rows would stay wrong forever.
 *
 * For every ticket-source case with a first-response commitment, this
 * recomputes the start with `resolveFirstResponseStartedAt` over the case's
 * (already re-normalized, now stable) events and, when it disagrees with the
 * stored `startedAt`, deletes that one commitment (its evaluations and
 * notification records cascade). The next commitment pipeline run recreates
 * it with the right start, or — when the rule says there is nothing to start
 * on — never creates it. It also lets a case that was wrongly *missing* its
 * first response (customer-created, mis-read as agent-created) be created
 * on the next run, with no action here.
 *
 * Dry run by default; pass `--apply` to delete. Idempotent: after an apply a
 * second run finds nothing. Scope with `--organization-id=<id>`. Run:
 *   pnpm --filter @sla/commitments repair:first-response-start [-- --apply --organization-id=...]
 * then run the worker cycle (or `runCommitmentPipeline`) to recreate.
 */

export interface RepairFirstResponseStartResult {
  considered: number;
  /** Commitments whose stored start disagrees with the rule. */
  mismatched: {
    commitmentId: string;
    caseExternalId: string;
    storedStartedAt: string;
    expectedStartedAt: string | null;
    status: string;
  }[];
  deleted: number;
}

export async function repairFirstResponseStart(
  prisma: PrismaClient,
  options: { apply?: boolean; organizationId?: string } = {},
): Promise<RepairFirstResponseStartResult> {
  const rows = await prisma.commitment.findMany({
    where: {
      kind: "first_response",
      case: { deletedAt: null, ...(options.organizationId ? { organizationId: options.organizationId } : {}) },
    },
    select: {
      id: true,
      caseId: true,
      startedAt: true,
      status: true,
      case: { select: { externalId: true, openedAt: true } },
    },
  });
  const result: RepairFirstResponseStartResult = { considered: rows.length, mismatched: [], deleted: 0 };
  if (rows.length === 0) return result;

  const eventRows = await prisma.normalizedEvent.findMany({
    where: {
      caseId: { in: [...new Set(rows.map((r) => r.caseId))] },
      type: { in: ["case_created", "customer_replied"] },
    },
  });
  const eventsByCaseId = new Map<string, ReturnType<typeof toNormalizedEventDomain>[]>();
  for (const eventRow of eventRows) {
    const event = toNormalizedEventDomain(eventRow);
    const bucket = eventsByCaseId.get(event.caseId);
    if (bucket) bucket.push(event);
    else eventsByCaseId.set(event.caseId, [event]);
  }

  for (const row of rows) {
    const expected = resolveFirstResponseStartedAt(eventsByCaseId.get(row.caseId) ?? [], row.case.openedAt.toISOString());
    if (expected !== null && new Date(expected).getTime() === row.startedAt.getTime()) continue;
    result.mismatched.push({
      commitmentId: row.id,
      caseExternalId: row.case.externalId,
      storedStartedAt: row.startedAt.toISOString(),
      expectedStartedAt: expected,
      status: row.status,
    });
  }

  if (options.apply && result.mismatched.length > 0) {
    const deleted = await prisma.commitment.deleteMany({
      where: { id: { in: result.mismatched.map((m) => m.commitmentId) }, kind: "first_response" },
    });
    result.deleted = deleted.count;
  }
  return result;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const apply = process.argv.includes("--apply");
  const organizationId = process.argv.find((a) => a.startsWith("--organization-id="))?.split("=")[1];
  repairFirstResponseStart(getPrismaClient(), { apply, organizationId })
    .then((result) => {
      console.log(
        `${apply ? "Deleted" : "Would delete"} ${apply ? result.deleted : result.mismatched.length} of ${result.considered} first-response commitment(s) whose start disagrees with the rule.`,
      );
      for (const m of result.mismatched) console.log(JSON.stringify(m));
      if (!apply && result.mismatched.length > 0) console.log("Dry run. Re-run with --apply, then run the commitment pipeline to recreate.");
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("repair-first-response-start failed:", error);
      process.exit(1);
    });
}
