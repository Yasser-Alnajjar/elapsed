import {
  connectAdvisoryLockConnection,
  getOrCreateWorkerSettings,
  getPrismaClient,
  recordWorkerCycleOutcome,
  recordWorkerNextRun,
  WORKER_ADVISORY_LOCK_KEY,
} from "@sla/db";
import { createLogger } from "@sla/logger";
import { loadWorkerConfig } from "./config";
import { runCycle, type CycleKind } from "./cycle";
import { startHealthServer, type WorkerHealthServer } from "./health-server";
import { startWorkerLeadership, type WorkerLeadership } from "./leader-lock";
import { captureException, flushSentry, initSentry } from "./sentry";
import { startStalledCycleWatchdog } from "./watchdog";

// First, before anything else can throw — every capture call below is a
// no-op until this runs, so it must run before `main()`'s own await points.
initSentry();

const logger = createLogger();
const prisma = getPrismaClient();
const config = loadWorkerConfig();
let healthServer: WorkerHealthServer | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let leadership: WorkerLeadership | null = null;

/**
 * Cycles are serialized: both kinds advance the same per-integration cursor,
 * so running two at once would race on it and double-fetch. A cycle requested
 * while another is in flight is skipped rather than queued — the next tick
 * picks up the same work, and skipping is harmless because every stage is
 * idempotent (`(integrationId, providerEventId)` on RawEvent, a deterministic
 * Evaluation id, `@@unique([caseId, kind])` on Commitment).
 */
let inFlight = false;
let shuttingDown = false;

/**
 * `setTimeout`, not `setInterval`: each kind reschedules only itself, only
 * after its own tick fully finishes, re-reading the current interval from
 * the database at that point. That's what makes an owner's change from the
 * Monitoring settings page take effect on the very next tick with no
 * restart, and it's structurally impossible to end up with two timers for
 * the same kind — the next one is never created until the current run (and
 * any reschedule from a previous change) is done.
 */
const timers: Record<CycleKind, NodeJS.Timeout | null> = {
  active_set_poll: null,
  reconciliation_sweep: null,
};

async function currentIntervalMs(kind: CycleKind): Promise<number> {
  const settings = await getOrCreateWorkerSettings(prisma);
  return kind === "active_set_poll" ? settings.activePollIntervalMs : settings.reconciliationIntervalMs;
}

function scheduleNext(kind: CycleKind): void {
  if (shuttingDown) return;
  void currentIntervalMs(kind).then(async (intervalMs) => {
    if (shuttingDown) return;
    // Persisted here — the moment a timer is actually armed — rather than
    // derived from `last*At + intervalMs` anywhere downstream: this is the
    // one place that knows both the just-read interval and that a timer is
    // really about to be set for it.
    await recordWorkerNextRun(prisma, kind, new Date(Date.now() + intervalMs));
    if (shuttingDown) return;
    timers[kind] = setTimeout(() => void tick(kind), intervalMs);
  });
}

async function tick(kind: CycleKind): Promise<void> {
  if (inFlight) {
    logger.info("cycle_skipped", { kind, reason: "another cycle in flight" });
    scheduleNext(kind);
    return;
  }

  inFlight = true;
  const startedAt = Date.now();
  // Ties every structured log line this cycle produces — including ones
  // emitted per-organization/per-integration deep in `cycle.ts` — to one
  // run (roadmap 7.4).
  const cycleId = `${kind}:${startedAt}`;
  try {
    const activePollMs = (await getOrCreateWorkerSettings(prisma)).activePollIntervalMs;
    const result = await runCycle(prisma, config, kind, cycleId, { activePollMs });
    await recordWorkerCycleOutcome(prisma, kind, result.failures.length);
    logger.info("cycle_finished", { cycleId, durationMs: Date.now() - startedAt, ...result });
  } catch (error) {
    await recordWorkerCycleOutcome(prisma, kind, null);
    captureException(error, { kind, stage: "cycle" });
    logger.error("cycle_failed", {
      kind,
      cycleId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    inFlight = false;
  }

  scheduleNext(kind);
}

async function main(): Promise<void> {
  const settings = await getOrCreateWorkerSettings(prisma);
  logger.info("worker_started", {
    activePollMs: settings.activePollIntervalMs,
    reconciliationMs: settings.reconciliationIntervalMs,
    appUrlConfigured: config.appUrl !== null,
    healthPort: config.healthPort,
    opsAlertConfigured: config.opsAlert !== null,
  });

  // Leadership before the health server so the server can always ask for
  // the current role; the health server itself still starts immediately, so
  // a standby is probeable while it waits.
  leadership = startWorkerLeadership({
    connect: () => connectAdvisoryLockConnection(),
    lockKey: WORKER_ADVISORY_LOCK_KEY,
    retryMs: config.lockRetryMs,
    pingMs: config.lockPingMs,
    onAcquired: startCycles,
    // Exit rather than try to recover in place: another instance may take
    // the lock the moment this connection dropped, and every stage is
    // idempotent, so a cycle cut off mid-way is safe. The restart policy
    // brings this process back, into standby if the other one won.
    onLost: () => void shutdown("advisory_lock_lost", 1),
  });
  const currentLeadership = leadership;
  healthServer = startHealthServer(prisma, config.healthPort, () => currentLeadership.role());
}

function startCycles(): void {
  if (shuttingDown) return;
  // Only the lock holder watches for stalls: a standby alerting too would
  // just duplicate every page.
  watchdogTimer = startStalledCycleWatchdog(prisma, config.opsAlert);

  // Active-set poll runs immediately on boot; reconciliation only after its
  // own interval first elapses — same startup order as before this file
  // moved to dynamic scheduling.
  void tick("active_set_poll");
  scheduleNext("reconciliation_sweep");
}

void main();

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  logger.info("worker_stopping", { signal });
  shuttingDown = true;
  for (const kind of Object.keys(timers) as CycleKind[]) {
    if (timers[kind]) clearTimeout(timers[kind]);
  }
  if (watchdogTimer) clearInterval(watchdogTimer);
  if (healthServer) await healthServer.close();
  if (leadership) await leadership.stop();
  await flushSentry();
  await prisma.$disconnect();
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Node's own guidance: the process is in an undefined state after either of
// these, so log/capture and exit non-zero rather than keep running — the
// container's restart policy (docker-compose.prod.yml: `unless-stopped`) is
// what actually recovers, matching every other "fail loud, let the
// supervisor restart it" choice already made in this file's shutdown path.
process.on("uncaughtException", (error) => {
  captureException(error, { stage: "uncaughtException" });
  logger.error("uncaught_exception", { error: error.message });
  void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  captureException(reason, { stage: "unhandledRejection" });
  logger.error("unhandled_rejection", { error: reason instanceof Error ? reason.message : String(reason) });
  void shutdown("unhandledRejection", 1);
});
