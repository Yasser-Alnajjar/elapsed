import type { ClaimedWork } from "@sla/db";
import type { Logger } from "@sla/logger";

/**
 * Thrown when this worker no longer owns the organization it is processing:
 * its lease was re-claimed by another worker, expired (locally or in the
 * database), or was abandoned at shutdown. It is not a stage failure — the
 * run stops, records nothing, and the new owner carries on.
 */
export class LeaseLostError extends Error {
  constructor(
    readonly organizationId: string,
    readonly reason: string,
  ) {
    super(`lease on organization ${organizationId} lost: ${reason}`);
    this.name = "LeaseLostError";
  }
}

/** What the processing code sees of a lease. */
export interface LeaseGuard {
  /** Cheap, local: no lease loss has been observed and the lease hasn't outlived its TTL by this worker's own monotonic clock. */
  isValid(): boolean;
  /** Throws `LeaseLostError` unless `isValid()`. Call before each stage that writes. */
  assertValid(): void;
  /** Like `assertValid`, but also confirms against the database row. Call before steps that can't be undone. */
  assertHeld(): Promise<void>;
}

/** The two database operations a lease needs — injected so the keeper can be tested without Postgres. */
export interface LeaseStore {
  renew(claim: ClaimedWork): Promise<boolean>;
  isHeld(claim: ClaimedWork): Promise<boolean>;
}

export interface LeaseKeeper extends LeaseGuard {
  /** Stops renewing. Call when the run finishes, however it finishes. */
  stop(): void;
  /** Marks the lease as no longer usable (graceful shutdown past its deadline) so the next `assert*` throws. */
  abandon(reason: string): void;
  lostReason(): string | null;
}

export interface LeaseKeeperOptions {
  claim: ClaimedWork;
  store: LeaseStore;
  logger: Logger;
  /** Monotonic milliseconds. Defaults to `performance.now`; injectable for tests. */
  now?: () => number;
  /** Renew this often. Default: a third of the TTL, so two consecutive failed renewals are survivable. */
  renewEveryMs?: number;
  /** The lease is treated as expired this long before the database would: covers the gap between sending a renewal and the server applying it. */
  safetyMarginMs?: number;
  /** When the claim request was *issued* on `now`'s clock (conservative: the server stamped the expiry after this). Defaults to now. */
  issuedAt?: number;
}

/**
 * Holds one lease for the duration of a run.
 *
 * Two independent ways to notice the lease is gone, because either alone has
 * a hole:
 *  - the *database* says so (a renewal or verification finds another owner or
 *    token) — authoritative, but only as fresh as the last round trip;
 *  - the worker's own *monotonic clock* says the lease has outlived its TTL
 *    since the last successful renewal — it needs no network, so it still
 *    works when the process was paused (GC, SIGSTOP, a stalled event loop)
 *    or cut off from the database, exactly when a rival may have taken over.
 * `assertValid` uses the second, cheaply, between stages; `assertHeld` adds
 * the first before irreversible steps.
 */
export function startLeaseKeeper(options: LeaseKeeperOptions): LeaseKeeper {
  const { claim, store, logger } = options;
  const now = options.now ?? (() => performance.now());
  const margin = options.safetyMarginMs ?? Math.min(5_000, claim.leaseTtlMs / 4);
  const renewEveryMs = options.renewEveryMs ?? Math.max(1, Math.floor(claim.leaseTtlMs / 3));

  let validUntil = (options.issuedAt ?? now()) + claim.leaseTtlMs - margin;
  let lost: string | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const log = logger.child({ organizationId: claim.organizationId, leaseToken: String(claim.leaseToken) });

  const markLost = (reason: string) => {
    if (lost !== null) return;
    lost = reason;
    if (timer) clearTimeout(timer);
    timer = null;
    log.warn("lease_lost", { reason, leaseOwner: claim.leaseOwner, kind: claim.kind });
  };

  const scheduleRenewal = () => {
    if (stopped || lost !== null) return;
    timer = setTimeout(() => void renew(), renewEveryMs);
    timer.unref?.();
  };

  const renew = async () => {
    if (stopped || lost !== null) return;
    const sentAt = now();
    try {
      if (await store.renew(claim)) {
        validUntil = sentAt + claim.leaseTtlMs - margin;
        log.info("lease_renewed", { kind: claim.kind });
      } else {
        markLost("lease was taken over by another worker");
        return;
      }
    } catch (error) {
      // Not proof the lease is gone — keep going on the local clock, which
      // ends the run by itself if the database stays unreachable.
      log.warn("lease_renew_failed", { error: error instanceof Error ? error.message : String(error) });
    }
    scheduleRenewal();
  };

  scheduleRenewal();

  const isValid = () => lost === null && now() < validUntil;
  const assertValid = () => {
    if (lost !== null) throw new LeaseLostError(claim.organizationId, lost);
    if (now() >= validUntil) {
      markLost("lease outlived its TTL without a successful renewal");
      throw new LeaseLostError(claim.organizationId, lost!);
    }
  };

  return {
    isValid,
    assertValid,
    async assertHeld() {
      assertValid();
      let held: boolean;
      try {
        held = await store.isHeld(claim);
      } catch (error) {
        // Can't confirm ownership: don't publish on a guess.
        throw new LeaseLostError(
          claim.organizationId,
          `ownership could not be verified (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      if (!held) {
        markLost("fenced out: the lease row belongs to a newer claim");
        throw new LeaseLostError(claim.organizationId, lost!);
      }
      assertValid();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    abandon(reason) {
      markLost(reason);
    },
    lostReason: () => lost,
  };
}
