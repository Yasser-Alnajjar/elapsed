import type { AdvisoryLockConnection } from "@sla/db";

/**
 * "acquiring": no lock attempt has completed yet (typically the database is
 * unreachable). "standby": another worker holds the election; this one
 * retries. "active": this worker holds it (and runs the watchdog).
 */
export type WorkerRole = "acquiring" | "standby" | "active";

export interface WorkerLeadershipOptions {
  connect: () => Promise<AdvisoryLockConnection>;
  lockKey: bigint;
  retryMs: number;
  /** How often the active instance round-trips its lock connection, so a silently dead one is noticed. */
  pingMs: number;
  onAcquired: () => void;
  /** The lock is gone (connection died): another worker may already hold the election, so the holder's duty must stop. */
  onLost: (error: Error) => void;
}

export interface WorkerLeadership {
  role(): WorkerRole;
  stop(): Promise<void>;
}

/**
 * Elects one worker process for duties that must happen exactly once across
 * the fleet, via a Postgres session-level advisory lock held for as long as
 * the process holds the election. Roadmap step 42 originally used this to
 * make the whole worker a singleton (two would have raced on
 * `Integration.cursor`); that protection now comes from per-organization
 * leases (`@sla/db`'s `OrganizationWorkState`), so every worker processes
 * organizations and this lock only decides who runs the stalled-work
 * watchdog — the one duty that would page twice if every worker did it.
 *
 * A process that doesn't win the election ("standby") just keeps retrying;
 * if the holder's connection dies the lock is released with its session and
 * another worker's next retry takes over.
 */
export function startWorkerLeadership(options: WorkerLeadershipOptions): WorkerLeadership {
  let role: WorkerRole = "acquiring";
  let connection: AdvisoryLockConnection | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let lost = false;

  const scheduleRetry = () => {
    if (stopped) return;
    retryTimer = setTimeout(() => void attempt(), options.retryMs);
  };

  const dropConnection = () => {
    const stale = connection;
    connection = null;
    if (stale) void stale.close().catch(() => undefined);
  };

  const loseLock = (error: Error) => {
    if (stopped || lost) return;
    lost = true;
    if (pingTimer) clearInterval(pingTimer);
    console.error(JSON.stringify({ event: "worker_lock_lost", error: error.message }));
    options.onLost(error);
  };

  const attempt = async () => {
    if (stopped) return;
    try {
      if (!connection) {
        const fresh = await options.connect();
        if (stopped) {
          await fresh.close();
          return;
        }
        connection = fresh;
        fresh.onLost((error) => {
          if (connection !== fresh) return;
          if (role === "active") {
            loseLock(error);
          } else {
            // A standby losing its connection holds nothing; reconnect on the next retry.
            connection = null;
          }
        });
      }

      const acquired = await connection.tryLock(options.lockKey);
      if (stopped) return;

      if (acquired) {
        role = "active";
        console.log(JSON.stringify({ event: "worker_lock_acquired" }));
        const held = connection;
        pingTimer = setInterval(() => {
          held.ping().catch((error: unknown) => loseLock(error instanceof Error ? error : new Error(String(error))));
        }, options.pingMs);
        options.onAcquired();
        return;
      }

      if (role !== "standby") {
        console.log(JSON.stringify({ event: "worker_standby", reason: "another worker instance holds the lock", retryMs: options.retryMs }));
      }
      role = "standby";
    } catch (error) {
      console.error(
        JSON.stringify({ event: "worker_lock_attempt_failed", error: error instanceof Error ? error.message : String(error) }),
      );
      dropConnection();
    }
    scheduleRetry();
  };

  void attempt();

  return {
    role: () => role,
    async stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      const held = connection;
      connection = null;
      if (held) await held.close().catch(() => undefined);
    },
  };
}
