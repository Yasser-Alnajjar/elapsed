import {
  connectAdvisoryLockConnection,
  getOrCreateWorkerSettings,
  getPrismaClient,
  recordOrganizationRunOutcome,
  recordWorkerHeartbeat,
  WORKER_ADVISORY_LOCK_KEY,
} from "@sla/db";
import { createLogger } from "@sla/logger";
import { loadWorkerConfig } from "./config";
import { startHealthServer, type WorkerHealthServer } from "./health-server";
import { startWorkerLeadership, type WorkerLeadership } from "./leader-lock";
import { createOrganizationProcessor } from "./organization-processor";
import { captureException, flushSentry, initSentry } from "./sentry";
import { createSettingsReader } from "./settings-reader";
import { startStalledCycleWatchdog } from "./watchdog";
import { startWorkLoop, type WorkLoop } from "./work-loop";
import { createDbWorkStore } from "./work-store";

// First, before anything else can throw — every capture call below is a
// no-op until this runs, so it must run before `main()`'s own await points.
initSentry();

const logger = createLogger();
const config = loadWorkerConfig();
// The pool is per process, so its size is part of the multi-worker
// connection budget — sized from the concurrency unless the operator set it
// (see `resolveDatabasePoolMax`). Must be in place before the client is built.
process.env.DATABASE_POOL_MAX = String(config.databasePoolMax);
const prisma = getPrismaClient();

let healthServer: WorkerHealthServer | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let leadership: WorkerLeadership | null = null;
let workLoop: WorkLoop | null = null;
let shuttingDown = false;

/**
 * Scheduling is not done here any more. Every worker process runs the same
 * loop (`work-loop.ts`): claim whichever organizations are due through the
 * database (`@sla/db`'s `OrganizationWorkState`), process them under a lease,
 * record the outcome and the next due time. Any number of workers can run at
 * once; the claim is what keeps two from processing the same organization, and
 * the lease's fencing token is what keeps a worker that lost one from
 * publishing stale results.
 *
 * What that replaces: one global "cycle" loop gated by a process-wide
 * advisory lock (one worker active, the rest standby), where an active cycle
 * over every organization blocked the next and reconciliation could be
 * skipped behind it.
 */
async function main(): Promise<void> {
  const settings = await getOrCreateWorkerSettings(prisma);
  logger.info("worker_started", {
    workerId: config.workerId,
    activePollMs: settings.activePollIntervalMs,
    reconciliationMs: settings.reconciliationIntervalMs,
    organizationConcurrency: config.organizationConcurrency,
    leaseTtlMs: config.leaseTtlMs,
    claimPollMs: config.claimPollMs,
    databasePoolMax: config.databasePoolMax,
    appUrlConfigured: config.appUrl !== null,
    healthPort: config.healthPort,
    opsAlertConfigured: config.opsAlert !== null,
  });

  healthServer = startHealthServer(prisma, config.healthPort, () => ({
    workerId: config.workerId,
    started: workLoop !== null,
    watchdogLeader: leadership?.role() === "active",
    msSinceLastTick: workLoop?.msSinceLastTick() ?? 0,
    loop: workLoop?.stats() ?? null,
    organizationConcurrency: config.organizationConcurrency,
    databasePoolMax: config.databasePoolMax,
  }));

  const readSettings = createSettingsReader(prisma);
  workLoop = startWorkLoop({
    workerId: config.workerId,
    capacity: config.organizationConcurrency,
    leaseTtlMs: config.leaseTtlMs,
    claimPollMs: config.claimPollMs,
    logger,
    store: createDbWorkStore(prisma, config.workerId),
    process: createOrganizationProcessor({
      prisma,
      config,
      logger,
      activePollMs: async () => (await readSettings()).activePollIntervalMs,
      monthlyReportEnabled: async () => (await readSettings()).monthlyReportEnabled,
      entitlementsEnforced: async () => (await readSettings()).entitlementsEnforced,
    }),
    intervals: async () => {
      const current = await readSettings();
      return { activeIntervalMs: current.activePollIntervalMs, reconciliationIntervalMs: current.reconciliationIntervalMs };
    },
    heartbeat: () => recordWorkerHeartbeat(prisma),
    onRunRecorded: (claim) => recordOrganizationRunOutcome(prisma, claim.kind, claim.startedAt),
  });

  startWatchdogLeadership();
}

/**
 * The advisory lock is no longer a worker-wide leader lock that serializes
 * all processing — it only elects which one worker runs the stalled-work
 * watchdog, the one duty that would page twice if every worker did it. Losing
 * the election is not fatal: the work loop carries on, this worker just stops
 * watching, and tries to win the election back.
 */
function startWatchdogLeadership(): void {
  if (shuttingDown) return;
  const current = startWorkerLeadership({
    connect: () => connectAdvisoryLockConnection(),
    lockKey: WORKER_ADVISORY_LOCK_KEY,
    retryMs: config.lockRetryMs,
    pingMs: config.lockPingMs,
    onAcquired: () => {
      if (shuttingDown) return;
      logger.info("watchdog_leader_acquired", { workerId: config.workerId });
      watchdogTimer = startStalledCycleWatchdog(prisma, config.opsAlert);
    },
    onLost: () => {
      logger.warn("watchdog_leader_lost", { workerId: config.workerId });
      if (watchdogTimer) clearInterval(watchdogTimer);
      watchdogTimer = null;
      void current.stop().finally(() => {
        if (!shuttingDown) setTimeout(startWatchdogLeadership, config.lockRetryMs).unref();
      });
    },
  });
  leadership = current;
}

void main();

/**
 * Graceful shutdown: stop claiming, let in-flight organizations finish and
 * record themselves (up to `WORKER_SHUTDOWN_GRACE_MS`), then release whatever
 * is still running so another worker can take it straight away instead of
 * waiting for the lease to expire. Every stage is idempotent, so cutting a
 * run off is safe; finishing it is just cheaper than redoing it. A fatal
 * error skips the grace period — the process state is undefined.
 */
async function shutdown(signal: string, exitCode = 0, graceMs = config.shutdownGraceMs): Promise<void> {
  // Re-entry guard: `pnpm -r` and `tsx watch` each forward SIGINT, so this
  // runs twice on one Ctrl+C; a second `healthServer.close()` rejects with
  // ERR_SERVER_NOT_RUNNING, which `unhandledRejection` below turned into yet
  // another shutdown.
  if (shuttingDown) return;
  logger.info("worker_stopping", { signal, workerId: config.workerId, graceMs });
  shuttingDown = true;
  if (watchdogTimer) clearInterval(watchdogTimer);
  try {
    if (workLoop) {
      const { abandoned } = await workLoop.stop(graceMs);
      logger.info("worker_drained", { workerId: config.workerId, abandoned, ...workLoop.stats() });
    }
    if (leadership) await leadership.stop();
    if (healthServer) await healthServer.close();
    await flushSentry();
    await prisma.$disconnect();
  } catch (error) {
    logger.error("worker_shutdown_error", { error: error instanceof Error ? error.message : String(error) });
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Node's own guidance: the process is in an undefined state after either of
// these, so log/capture and exit non-zero rather than keep running — the
// container's restart policy (docker-compose.yml: `unless-stopped`) is
// what actually recovers, matching every other "fail loud, let the
// supervisor restart it" choice already made in this file's shutdown path.
process.on("uncaughtException", (error) => {
  captureException(error, { stage: "uncaughtException" });
  logger.error("uncaught_exception", { error: error.message });
  void shutdown("uncaughtException", 1, 0);
});

process.on("unhandledRejection", (reason) => {
  captureException(reason, { stage: "unhandledRejection" });
  logger.error("unhandled_rejection", { error: reason instanceof Error ? reason.message : String(reason) });
  void shutdown("unhandledRejection", 1, 0);
});
