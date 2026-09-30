import type { ClaimedWork } from "@sla/db";
import type { Logger } from "@sla/logger";
import { LeaseLostError, startLeaseKeeper, type LeaseGuard, type LeaseKeeper } from "./lease";
import type { WorkStore } from "./work-store";

export interface ProcessResult {
  /** Number of recorded stage failures — data, not a thrown error. */
  failures: number;
  /** First failure message, kept on the work-state row. */
  error?: string | null;
}

export interface WorkIntervals {
  activeIntervalMs: number;
  /** Already capped at the 30-minute ceiling. */
  reconciliationIntervalMs: number;
}

export interface WorkLoopOptions {
  workerId: string;
  /** Organizations this worker processes at once (the configured organization concurrency). */
  capacity: number;
  leaseTtlMs: number;
  /** Longest an idle loop sleeps between claim attempts; also how quickly a newly created organization is noticed. */
  claimPollMs: number;
  /** How often to create work-state rows for organizations that lack one. */
  ensureEveryMs?: number;
  /** How often to call `heartbeat`. */
  heartbeatEveryMs?: number;
  logger: Logger;
  store: WorkStore;
  /** Runs one claimed organization. Throws `LeaseLostError` if the lease is lost; other throws are recorded as a failed run. */
  process: (claim: ClaimedWork, lease: LeaseGuard) => Promise<ProcessResult>;
  /** Current scheduling intervals, read fresh for every completion so a Monitoring change applies to the very next run. */
  intervals: () => Promise<WorkIntervals>;
  heartbeat?: () => Promise<void>;
  /** Called after a run's outcome was recorded (not when it was fenced out). */
  onRunRecorded?: (claim: ClaimedWork, result: ProcessResult | null) => Promise<void>;
  /** Monotonic ms. Injectable for tests. */
  now?: () => number;
}

export interface WorkLoopStats {
  running: number;
  peakRunning: number;
  claimed: number;
  completed: number;
  failedRuns: number;
  leaseLost: number;
  fencedCompletions: number;
  recoveredLeases: number;
}

export interface StopResult {
  /** Runs still going when the grace period ended; their leases were released. */
  abandoned: number;
}

export interface WorkLoop {
  stats(): WorkLoopStats;
  /** Milliseconds since the loop last made progress (claimed, slept or recovered from an error) — the process's own liveness signal. */
  msSinceLastTick(): number;
  /**
   * Stops claiming immediately, then waits up to `graceMs` for in-flight runs
   * to finish and record themselves. Whatever is still running after that is
   * abandoned: its lease is marked lost locally (so its next stage check
   * throws) and released in the database (so another worker can take the
   * organization at once). Safe at any point — every stage is idempotent.
   */
  stop(graceMs: number): Promise<StopResult>;
}

const RELEASE_TIMEOUT_MS = 5_000;

interface Running {
  claim: ClaimedWork;
  keeper: LeaseKeeper;
  done: Promise<void>;
}

/**
 * The multi-worker scheduler: one loop per process, no leader. Each pass it
 * claims as many due organizations as it has free capacity for, starts them,
 * and sleeps until the earliest moment anything becomes claimable (or until
 * one of its own runs finishes and frees a slot). Coordination between
 * processes is entirely the claim — see `organization-work-state.ts`.
 */
export function startWorkLoop(options: WorkLoopOptions): WorkLoop {
  const { logger, store } = options;
  const now = options.now ?? (() => performance.now());
  const ensureEveryMs = options.ensureEveryMs ?? 30_000;
  const heartbeatEveryMs = options.heartbeatEveryMs ?? 15_000;

  const running = new Set<Running>();
  const stats: WorkLoopStats = {
    running: 0,
    peakRunning: 0,
    claimed: 0,
    completed: 0,
    failedRuns: 0,
    leaseLost: 0,
    fencedCompletions: 0,
    recoveredLeases: 0,
  };
  let stopping = false;
  let lastTickAt = now();
  let wake: (() => void) | null = null;
  // A signal raised while the loop is mid-pass (not sleeping) must not be
  // lost, or a slot freed at that moment would sit idle for a whole poll.
  let signalled = false;

  const signal = () => {
    signalled = true;
    wake?.();
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (signalled) {
        signalled = false;
        return resolve();
      }
      const timer = setTimeout(done, Math.max(0, ms));
      function done() {
        clearTimeout(timer);
        wake = null;
        signalled = false;
        resolve();
      }
      wake = done;
    });

  async function recordRun(claim: ClaimedWork, result: ProcessResult | null, log: Logger): Promise<void> {
    const failed = result === null ? true : result.failures > 0;
    const intervals = await options.intervals();
    const recorded = await store.complete(claim, {
      failed,
      error: result?.error ?? null,
      activeIntervalMs: intervals.activeIntervalMs,
      reconciliationIntervalMs: intervals.reconciliationIntervalMs,
    });
    if (!recorded) {
      // The lease had already moved on: the new owner's result is the one
      // that counts, and this worker records nothing.
      stats.fencedCompletions += 1;
      log.warn("work_result_fenced", { reason: "lease no longer held at completion" });
      return;
    }
    stats.completed += 1;
    if (failed) stats.failedRuns += 1;
    await options.onRunRecorded?.(claim, result);
  }

  function launch(claim: ClaimedWork, issuedAt: number): void {
    const log = logger.child({ organizationId: claim.organizationId, kind: claim.kind, leaseToken: String(claim.leaseToken) });
    const keeper = startLeaseKeeper({ claim, store, logger, issuedAt, now });
    const startedAt = now();
    stats.claimed += 1;
    if (claim.recoveredFromOwner) {
      stats.recoveredLeases += 1;
      log.warn("lease_recovered", { previousOwner: claim.recoveredFromOwner });
    }
    log.info("work_started", { leaseOwner: claim.leaseOwner, running: running.size + 1, capacity: options.capacity });

    const entry: Running = {
      claim,
      keeper,
      done: (async () => {
        let result: ProcessResult | null = null;
        let outcomeKnown = false;
        try {
          result = await options.process(claim, keeper);
          outcomeKnown = true;
        } catch (error) {
          if (error instanceof LeaseLostError) {
            stats.leaseLost += 1;
            log.warn("work_abandoned", { reason: error.reason });
          } else {
            outcomeKnown = true;
            const message = error instanceof Error ? error.message : String(error);
            result = { failures: 1, error: message };
            log.error("work_failed", { error: message });
          }
        } finally {
          keeper.stop();
        }
        // Logged while the lease is still held (completion below is what releases it), so its timestamp is an
        // honest upper bound for "this worker stopped working on the organization".
        log.info("work_processed", { durationMs: Math.round(now() - startedAt), failures: result?.failures ?? 0, leaseLost: !outcomeKnown });
        if (outcomeKnown) {
          try {
            await recordRun(claim, result, log);
          } catch (error) {
            // Couldn't record: the lease simply expires and the work is re-claimed — idempotent.
            log.error("work_record_failed", { error: error instanceof Error ? error.message : String(error) });
          }
          log.info("work_finished", {
            durationMs: Math.round(now() - startedAt),
            failures: result?.failures ?? 0,
          });
        }
      })().finally(() => {
        running.delete(entry);
        stats.running = running.size;
        signal();
      }),
    };
    running.add(entry);
    stats.running = running.size;
    stats.peakRunning = Math.max(stats.peakRunning, running.size);
  }

  let lastEnsureAt = Number.NEGATIVE_INFINITY;
  let lastHeartbeatAt = Number.NEGATIVE_INFINITY;

  async function pass(): Promise<number> {
    if (now() - lastEnsureAt >= ensureEveryMs) {
      const { reconciliationIntervalMs } = await options.intervals();
      const created = await store.ensure(reconciliationIntervalMs);
      lastEnsureAt = now();
      if (created > 0) logger.info("work_states_created", { count: created });
    }
    if (options.heartbeat && now() - lastHeartbeatAt >= heartbeatEveryMs) {
      lastHeartbeatAt = now();
      await options.heartbeat().catch((error: unknown) =>
        logger.warn("heartbeat_failed", { error: error instanceof Error ? error.message : String(error) }),
      );
    }

    const free = options.capacity - running.size;
    if (free <= 0) return options.claimPollMs; // full: only a finishing run (signal) makes room

    const issuedAt = now();
    const claims = await store.claim(free, options.leaseTtlMs);
    for (const claim of claims) launch(claim, issuedAt);
    if (claims.length === free) return options.claimPollMs; // now full

    // Nothing more is due right now: sleep until something will be — never longer than one poll.
    const untilNext = await store.msUntilNextClaimable();
    return Math.min(options.claimPollMs, untilNext ?? options.claimPollMs);
  }

  const loop = (async () => {
    while (!stopping) {
      let sleepMs: number;
      try {
        sleepMs = await pass();
      } catch (error) {
        logger.error("work_loop_error", { error: error instanceof Error ? error.message : String(error) });
        sleepMs = Math.max(options.claimPollMs, 2_000);
      }
      lastTickAt = now();
      if (!stopping && sleepMs > 0) await sleep(sleepMs);
    }
  })();

  return {
    stats: () => ({ ...stats }),
    msSinceLastTick: () => now() - lastTickAt,
    async stop(graceMs) {
      stopping = true;
      signal();
      await loop;

      const settled = Promise.all([...running].map((entry) => entry.done));
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), graceMs);
      });
      const outcome = await Promise.race([settled.then(() => "drained" as const), deadline]);
      clearTimeout(timer);
      if (outcome === "drained") return { abandoned: 0 };

      const leftover = [...running];
      // In parallel and time-boxed: a database that is unreachable (the very
      // reason a run may be stuck) must not also hang the shutdown. An
      // unreleased lease just expires on its own after the TTL.
      await Promise.all(
        leftover.map(async (entry) => {
          entry.keeper.abandon("worker shutting down");
          const released = await Promise.race([
            store.release(entry.claim).catch(() => false),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), RELEASE_TIMEOUT_MS).unref()),
          ]);
          logger.warn("work_released_at_shutdown", {
            organizationId: entry.claim.organizationId,
            kind: entry.claim.kind,
            released,
          });
        }),
      );
      return { abandoned: leftover.length };
    },
  };
}
