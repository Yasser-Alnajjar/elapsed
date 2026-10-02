import type { ClaimedWork, PrismaClient } from "@sla/db";
import { createLogger, type Logger } from "@sla/logger";
import type { WorkerConfig } from "./config";
import { emptyCycleResult, ORGANIZATION_TO_PROCESS_SELECT, processOrganization, type CycleKind } from "./cycle";
import { createFencedPrisma } from "./fenced-prisma";
import type { LeaseGuard } from "./lease";
import type { ProcessResult } from "./work-loop";

const KIND_BY_WORK: Record<ClaimedWork["kind"], CycleKind> = {
  active: "active_set_poll",
  reconciliation: "reconciliation_sweep",
};

/**
 * Adapts `processOrganization` (the per-organization body of a cycle) to the
 * work loop: loads the claimed organization, runs it under its lease, and
 * reports a failure count. Provider ingestion, normalization and evaluation
 * all happen inside — so all of it is covered by the organization lease, not
 * just the projection phase the advisory lock guards: stage boundaries check
 * the `LeaseGuard`, and the sync cursor can't be written at all once the lease
 * is gone.
 */
export function createOrganizationProcessor(options: {
  prisma: PrismaClient;
  config: WorkerConfig;
  logger: Logger;
  activePollMs: () => Promise<number>;
  /** The operator kill switch for the monthly customer report (N5.6). Omitted: on. */
  monthlyReportEnabled?: () => Promise<boolean>;
}) {
  const { prisma, config, logger } = options;
  let inFlight = 0;

  return async function processClaim(claim: ClaimedWork, lease: LeaseGuard): Promise<ProcessResult> {
    const kind = KIND_BY_WORK[claim.kind];
    const organization = await prisma.organization.findUnique({
      where: { id: claim.organizationId },
      select: ORGANIZATION_TO_PROCESS_SELECT,
    });
    if (!organization) {
      // Deleted between claim and load; its work-state row cascades away too.
      logger.info("organization_gone", { organizationId: claim.organizationId });
      return { failures: 0 };
    }

    const result = emptyCycleResult(kind);
    const cycleId = `${kind}:${claim.organizationId}:${claim.leaseToken}`;
    const activePollMs = await options.activePollMs();

    inFlight += 1;
    try {
      // Everything this run writes to an Integration row goes through the fence (see `fenced-prisma.ts`).
      await processOrganization(createFencedPrisma(prisma, claim), config, organization, {
        kind,
        logger: createLogger({ cycleId, kind, workerId: claim.leaseOwner }),
        result,
        activePollMs,
        monthlyReportEnabled: options.monthlyReportEnabled,
        position: "1/1",
        inFlight: () => inFlight,
        lease,
      });
    } finally {
      inFlight -= 1;
    }

    const first = result.failures[0];
    return { failures: result.failures.length, error: first ? `${first.stage}: ${first.error}` : null };
  };
}
