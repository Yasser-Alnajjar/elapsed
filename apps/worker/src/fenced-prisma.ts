import type { ClaimedWork, PrismaClient } from "@sla/db";
import { LeaseLostError } from "./lease";

/**
 * A Prisma client whose writes to `Integration` rows — the provider sync
 * cursor, sync health, status and token-refresh compare-and-swaps — are
 * conditional on the caller still holding the organization's lease.
 *
 * This is the fencing that the provider packages can't do themselves. They
 * persist the cursor from deep inside `run*Backfill`, where no stage boundary
 * exists for `LeaseGuard` to check at, so a worker that stalled past its lease
 * (GC, SIGSTOP, a partition) and then resumed would finish its backfill and
 * overwrite the cursor with stale state the new owner had already advanced.
 * Here the check is part of the write itself: the `WHERE` also requires the
 * organization's work-state row to carry this claim's owner *and* fencing
 * token, so the database applies the write and the ownership test atomically —
 * there is no window between "checked" and "written" for a takeover to slip
 * into.
 *
 *  - `update` that matches nothing because the lease moved on throws
 *    `LeaseLostError`, which the cycle lets propagate instead of recording it as
 *    a sync failure;
 *  - `updateMany` (the compare-and-swap writes) simply matches zero rows, which
 *    every caller already treats as "lost the race, leave it";
 *  - an `Integration` belonging to another organization can't be written under
 *    this claim at all, since the condition is on *that* row's own organization.
 *
 * Only `Integration` writes are fenced: `RawEvent` is append-only and
 * idempotent, and everything the projection phase writes is deterministic from
 * `RawEvent`s and guarded by the advisory lock and the `LeaseGuard` checks.
 */
export function createFencedPrisma(prisma: PrismaClient, claim: ClaimedWork): PrismaClient {
  // `organizationId` is part of the condition because owner + token alone are
  // not unique across organizations (one worker holds many leases, and every
  // organization's tokens start at 1): without it, organization A's claim
  // would also open organization B's integrations whenever B happens to be
  // leased by the same worker at the same token.
  const holdsLease = {
    organizationId: claim.organizationId,
    organization: { workState: { is: { leaseOwner: claim.leaseOwner, leaseToken: claim.leaseToken } } },
  };

  return prisma.$extends({
    name: "lease-fence",
    query: {
      integration: {
        async update({ args, query }) {
          try {
            return await query({ ...args, where: { ...args.where, ...holdsLease } });
          } catch (error) {
            // P2025: "record to update not found" — the row exists, so it is the lease condition that failed.
            if ((error as { code?: string }).code === "P2025") {
              throw new LeaseLostError(claim.organizationId, "integration write rejected: lease no longer held");
            }
            throw error;
          }
        },
        async updateMany({ args, query }) {
          return query({ ...args, where: { AND: [args.where ?? {}, holdsLease] } });
        },
      },
    },
  }) as unknown as PrismaClient;
}
