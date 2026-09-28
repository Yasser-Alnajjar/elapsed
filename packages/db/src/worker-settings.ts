import type { PrismaClient } from "../generated/prisma/client";

const SINGLETON_ID = "singleton";

// Absolute bounds — independent of any org's configured SLA targets. Kept
// deliberately generous: the relative check below (against the shortest
// configured SLA target on the whole platform) is what actually protects
// breach detection; these just stop an obviously nonsensical value (0,
// negative, or "once a week") from ever reaching the scheduler.
export const MIN_ACTIVE_POLL_INTERVAL_MS = 5_000; // 5 seconds
export const MAX_ACTIVE_POLL_INTERVAL_MS = 30 * 60_000; // 30 minutes
export const MIN_RECONCILIATION_INTERVAL_MS = 5 * 60_000; // 5 minutes
export const MAX_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60_000; // 24 hours

/**
 * The active-set poll must run comfortably more often than the fastest SLA
 * target on the platform can elapse, or a commitment can blow through a
 * `warnAtPercent` threshold — or breach outright — between two checks
 * without ever being evaluated in between. 4x is a floor, not a tuning
 * knob: an operator who wants finer granularity than this just picks a
 * shorter interval, this only stops a config that is unsafe outright.
 */
export const ACTIVE_POLL_SAFETY_DIVISOR = 4;

const DEFAULT_ACTIVE_POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes
const DEFAULT_RECONCILIATION_INTERVAL_MS = 60 * 60_000; // 1 hour

export interface WorkerSettingsInput {
  activePollIntervalMs: number;
  reconciliationIntervalMs: number;
}

export interface WorkerSettingsRecord extends WorkerSettingsInput {
  lastHeartbeatAt: Date | null;
  lastActivePollAt: Date | null;
  lastActivePollFailures: number | null;
  lastReconciliationAt: Date | null;
  lastReconciliationFailures: number | null;
  /** The actual next execution time the worker's scheduler has queued — see this field's doc comment on the Prisma model. Owned exclusively by `recordWorkerNextRun`; never derived from `last*At + *IntervalMs` here or anywhere downstream. */
  nextActivePollAt: Date | null;
  nextReconciliationAt: Date | null;
}

export type WorkerStatus = "running" | "stopped" | "degraded";

/** Thrown by `saveWorkerSettings` when `input` fails validation — safe to surface directly to the caller. */
export class WorkerSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerSettingsValidationError";
  }
}

function readIntervalMsFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads the persisted worker config, creating the singleton row from the
 * `WORKER_ACTIVE_POLL_MS`/`WORKER_RECONCILIATION_MS` env vars (or their
 * hardcoded fallback) on first ever call — this is the "bootstrap from env"
 * step: env vars are only ever consulted here, to seed a fresh install, and
 * never again once the row exists. `upsert` (rather than
 * find-then-create) keeps this race-safe across apps/web and apps/worker
 * both potentially calling it at startup.
 */
export async function getOrCreateWorkerSettings(
  prisma: PrismaClient,
): Promise<WorkerSettingsRecord> {
  return prisma.workerSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      activePollIntervalMs: readIntervalMsFromEnv("WORKER_ACTIVE_POLL_MS", DEFAULT_ACTIVE_POLL_INTERVAL_MS),
      reconciliationIntervalMs: readIntervalMsFromEnv("WORKER_RECONCILIATION_MS", DEFAULT_RECONCILIATION_INTERVAL_MS),
    },
    update: {},
  });
}

/**
 * Read-only counterpart to `getOrCreateWorkerSettings` for callers that only
 * display the settings (the web app's Monitoring page, the layout's poll
 * interval) and don't need the singleton row to exist yet — a `findUnique`
 * plus the same env-var/hardcoded defaults used to seed it, with no write.
 * Keeps read-heavy paths (rendered on every page) off the write path that
 * `getOrCreateWorkerSettings`'s `upsert` puts on every call.
 */
export async function getWorkerSettingsForRead(
  prisma: PrismaClient,
): Promise<WorkerSettingsRecord> {
  const settings = await prisma.workerSettings.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (settings) return settings;

  return {
    activePollIntervalMs: readIntervalMsFromEnv("WORKER_ACTIVE_POLL_MS", DEFAULT_ACTIVE_POLL_INTERVAL_MS),
    reconciliationIntervalMs: readIntervalMsFromEnv("WORKER_RECONCILIATION_MS", DEFAULT_RECONCILIATION_INTERVAL_MS),
    lastHeartbeatAt: null,
    lastActivePollAt: null,
    lastActivePollFailures: null,
    lastReconciliationAt: null,
    lastReconciliationFailures: null,
    nextActivePollAt: null,
    nextReconciliationAt: null,
  };
}

/**
 * The shortest `targets[].minutes` across every organization's *latest*
 * SLAPolicyVersion, platform-wide. Worker settings are global (see this
 * file's doc comment on the singleton row), so the safety check in
 * `validateWorkerSettingsInput` must guard against the fastest SLA
 * commitment anywhere on the deployment, not just one organization. Returns
 * null when no organization has any SLA policy yet — nothing to guard
 * against.
 */
export async function getMinimumConfiguredSlaTargetMinutes(
  prisma: PrismaClient,
): Promise<number | null> {
  const versions = await prisma.sLAPolicyVersion.findMany({
    orderBy: { version: "asc" },
    select: { policyId: true, targets: true },
  });

  const latestTargetsByPolicy = new Map<string, unknown>();
  for (const version of versions) {
    // Ascending order means the last write per policyId is always its
    // highest version — i.e. the currently-effective one.
    latestTargetsByPolicy.set(version.policyId, version.targets);
  }

  let min: number | null = null;
  for (const targets of latestTargetsByPolicy.values()) {
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      const minutes = (target as { minutes?: unknown } | null)?.minutes;
      if (typeof minutes === "number" && Number.isFinite(minutes) && (min === null || minutes < min)) {
        min = minutes;
      }
    }
  }
  return min;
}

function formatMsForError(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round((ms / 3_600_000) * 10) / 10}h`;
}

/**
 * Pure validation — no DB access itself, so it's cheap to unit test.
 * `minConfiguredSlaTargetMinutes` comes from `getMinimumConfiguredSlaTargetMinutes`;
 * pass null when there are no SLA policies yet to skip the relative check.
 * Returns an error message, or null when `input` is valid.
 */
export function validateWorkerSettingsInput(
  input: WorkerSettingsInput,
  minConfiguredSlaTargetMinutes: number | null,
): string | null {
  const { activePollIntervalMs, reconciliationIntervalMs } = input;

  if (
    !Number.isInteger(activePollIntervalMs) ||
    activePollIntervalMs < MIN_ACTIVE_POLL_INTERVAL_MS ||
    activePollIntervalMs > MAX_ACTIVE_POLL_INTERVAL_MS
  ) {
    return `Active monitoring interval must be between ${formatMsForError(MIN_ACTIVE_POLL_INTERVAL_MS)} and ${formatMsForError(MAX_ACTIVE_POLL_INTERVAL_MS)}`;
  }

  if (
    !Number.isInteger(reconciliationIntervalMs) ||
    reconciliationIntervalMs < MIN_RECONCILIATION_INTERVAL_MS ||
    reconciliationIntervalMs > MAX_RECONCILIATION_INTERVAL_MS
  ) {
    return `Reconciliation interval must be between ${formatMsForError(MIN_RECONCILIATION_INTERVAL_MS)} and ${formatMsForError(MAX_RECONCILIATION_INTERVAL_MS)}`;
  }

  if (reconciliationIntervalMs < activePollIntervalMs) {
    return "Reconciliation interval must not be shorter than the active monitoring interval";
  }

  if (minConfiguredSlaTargetMinutes !== null) {
    const maxSafeActivePollMs = Math.floor(
      (minConfiguredSlaTargetMinutes * 60_000) / ACTIVE_POLL_SAFETY_DIVISOR,
    );
    if (activePollIntervalMs > maxSafeActivePollMs) {
      return `Active monitoring interval is too long for the shortest configured SLA target (${minConfiguredSlaTargetMinutes} minute${minConfiguredSlaTargetMinutes === 1 ? "" : "s"}) — choose ${formatMsForError(maxSafeActivePollMs)} or shorter`;
    }
  }

  return null;
}

/**
 * Validates and persists a new active-poll/reconciliation interval. Throws
 * `WorkerSettingsValidationError` on an invalid `input` — never trusts the
 * caller to have validated client-side already.
 */
export async function saveWorkerSettings(
  prisma: PrismaClient,
  input: WorkerSettingsInput,
): Promise<WorkerSettingsRecord> {
  const minTargetMinutes = await getMinimumConfiguredSlaTargetMinutes(prisma);
  const error = validateWorkerSettingsInput(input, minTargetMinutes);
  if (error) throw new WorkerSettingsValidationError(error);

  return prisma.workerSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      activePollIntervalMs: input.activePollIntervalMs,
      reconciliationIntervalMs: input.reconciliationIntervalMs,
    },
    update: {
      activePollIntervalMs: input.activePollIntervalMs,
      reconciliationIntervalMs: input.reconciliationIntervalMs,
    },
  });
}

/**
 * Called by the worker at the end of every tick. `failureCount` is
 * `CycleResult.failures.length` for a cycle that completed, or null when
 * `runCycle` itself threw (didn't complete) — in that case only the
 * heartbeat advances, so a repeatedly-crashing cycle shows as "degraded"
 * (process alive, no successful run) rather than falsely refreshing
 * `lastActivePollAt`/`lastReconciliationAt`.
 */
export async function recordWorkerCycleOutcome(
  prisma: PrismaClient,
  kind: "active_set_poll" | "reconciliation_sweep",
  failureCount: number | null,
): Promise<void> {
  const now = new Date();

  // Only set when the cycle actually completed (`failureCount !== null`) —
  // see this function's doc comment above.
  const completedFields =
    failureCount === null
      ? {}
      : kind === "active_set_poll"
        ? { lastActivePollAt: now, lastActivePollFailures: failureCount }
        : { lastReconciliationAt: now, lastReconciliationFailures: failureCount };

  await prisma.workerSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      activePollIntervalMs: readIntervalMsFromEnv("WORKER_ACTIVE_POLL_MS", DEFAULT_ACTIVE_POLL_INTERVAL_MS),
      reconciliationIntervalMs: readIntervalMsFromEnv("WORKER_RECONCILIATION_MS", DEFAULT_RECONCILIATION_INTERVAL_MS),
      lastHeartbeatAt: now,
      ...completedFields,
    },
    update: {
      lastHeartbeatAt: now,
      ...completedFields,
    },
  });
}

/**
 * Called by the worker's scheduler at the moment it arms the next timer for
 * `kind` (`apps/worker/src/index.ts`'s `scheduleNext`) — never on a fixed
 * tick, so this must not be called on any cadence shorter than "a schedule
 * was just decided". `nextRunAt` is the scheduler's own computed fire time,
 * not `last*At + *IntervalMs`: only the scheduler knows how long the
 * previous cycle actually took and which interval was current when it
 * decided to reschedule.
 */
export async function recordWorkerNextRun(
  prisma: PrismaClient,
  kind: "active_set_poll" | "reconciliation_sweep",
  nextRunAt: Date,
): Promise<void> {
  const field = kind === "active_set_poll" ? "nextActivePollAt" : "nextReconciliationAt";

  await prisma.workerSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      activePollIntervalMs: readIntervalMsFromEnv("WORKER_ACTIVE_POLL_MS", DEFAULT_ACTIVE_POLL_INTERVAL_MS),
      reconciliationIntervalMs: readIntervalMsFromEnv("WORKER_RECONCILIATION_MS", DEFAULT_RECONCILIATION_INTERVAL_MS),
      [field]: nextRunAt,
    },
    update: {
      [field]: nextRunAt,
    },
  });
}

/**
 * "stopped": no heartbeat within a generous multiple of the current active
 * interval — the worker process itself looks down. "degraded": the process
 * is alive but the latest completed cycle of either kind recorded
 * per-organization failures. "running": otherwise.
 */
export function deriveWorkerStatus(
  settings: WorkerSettingsRecord,
  now: Date = new Date(),
): WorkerStatus {
  const heartbeatStaleAfterMs = Math.max(settings.activePollIntervalMs * 3, 60_000);
  const heartbeatAgeMs = settings.lastHeartbeatAt ? now.getTime() - settings.lastHeartbeatAt.getTime() : Infinity;

  if (heartbeatAgeMs > heartbeatStaleAfterMs) return "stopped";
  if ((settings.lastActivePollFailures ?? 0) > 0 || (settings.lastReconciliationFailures ?? 0) > 0) return "degraded";
  return "running";
}
