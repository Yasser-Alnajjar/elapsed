import {
  claimDueOrganizations,
  completeWork,
  ensureOrganizationWorkStates,
  isLeaseHeld,
  msUntilNextClaimable,
  releaseLease,
  renewLease,
  type ClaimedWork,
  type PrismaClient,
  type WorkOutcome,
} from "@sla/db";
import type { LeaseStore } from "./lease";

/** Everything the work loop needs from the database — an interface so the loop is testable without one. */
export interface WorkStore extends LeaseStore {
  ensure(reconciliationIntervalMs: number): Promise<number>;
  claim(limit: number, leaseTtlMs: number): Promise<ClaimedWork[]>;
  complete(claim: ClaimedWork, outcome: WorkOutcome): Promise<boolean>;
  release(claim: ClaimedWork): Promise<boolean>;
  msUntilNextClaimable(): Promise<number | null>;
}

export function createDbWorkStore(prisma: PrismaClient, owner: string): WorkStore {
  return {
    ensure: (reconciliationIntervalMs) => ensureOrganizationWorkStates(prisma, { reconciliationIntervalMs }),
    claim: (limit, leaseTtlMs) => claimDueOrganizations(prisma, { owner, limit, leaseTtlMs }),
    renew: (claim) => renewLease(prisma, claim),
    isHeld: (claim) => isLeaseHeld(prisma, claim),
    complete: (claim, outcome) => completeWork(prisma, claim, outcome),
    release: (claim) => releaseLease(prisma, claim),
    msUntilNextClaimable: () => msUntilNextClaimable(prisma),
  };
}
