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
// Product requirement: a reconciliation pass runs at least every 30 minutes
// under normal operation, so 30 minutes is both the ceiling and the default.
// A row persisted before this limit existed may hold a larger value — every
// read below clamps it (`clampReconciliationIntervalMs`) instead of needing a
// data migration, so the worker can never schedule past the ceiling.
export const MAX_RECONCILIATION_INTERVAL_MS = 30 * 60_000; // 30 minutes
export const DEFAULT_RECONCILIATION_INTERVAL_MS = MAX_RECONCILIATION_INTERVAL_MS;

/** The reconciliation interval the scheduler may actually use: never above `MAX_RECONCILIATION_INTERVAL_MS`, whatever is persisted or set in the environment. */
export function clampReconciliationIntervalMs(ms: number): number {
  return Math.min(ms, MAX_RECONCILIATION_INTERVAL_MS);
}

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
  return withEffectiveIntervals(await prisma.workerSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      activePollIntervalMs: readIntervalMsFromEnv("WORKER_ACTIVE_POLL_MS", DEFAULT_ACTIVE_POLL_INTERVAL_MS),
      reconciliationIntervalMs: clampReconciliationIntervalMs(
        readIntervalMsFromEnv("WORKER_RECONCILIATION_MS", DEFAULT_RECONCILIATION_INTERVAL_MS),
      ),
    },
    update: {},
  }));
}

function withEffectiveIntervals(settings: WorkerSettingsRecord): WorkerSettingsRecord {
  return { ...settings, reconciliationIntervalMs: clampReconciliationIntervalMs(settings.reconciliationIntervalMs) };
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
  if (settings) return withEffectiveIntervals(settings);

  return {
    activePollIntervalMs: readIntervalMsFromEnv("WORKER_ACTIVE_POLL_MS", DEFAULT_ACTIVE_POLL_INTERVAL_MS),
    reconciliationIntervalMs: clampReconciliationIntervalMs(
      readIntervalMsFromEnv("WORKER_RECONCILIATION_MS", DEFAULT_RECONCILIATION_INTERVAL_MS),
    ),
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

/**
 * Keeps the singleton row's heartbeat fresh. With several workers there is no
 * "the" cycle end to hang the heartbeat on, so each worker calls this from its
 * own loop; any fresh heartbeat means at least one worker is alive.
 */
export async function recordWorkerHeartbeat(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  await prisma.workerSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      activePollIntervalMs: readIntervalMsFromEnv("WORKER_ACTIVE_POLL_MS", DEFAULT_ACTIVE_POLL_INTERVAL_MS),
      reconciliationIntervalMs: clampReconciliationIntervalMs(
        readIntervalMsFromEnv("WORKER_RECONCILIATION_MS", DEFAULT_RECONCILIATION_INTERVAL_MS),
      ),
      lastHeartbeatAt: now,
    },
    update: { lastHeartbeatAt: now },
  });
}

/**
 * Per-organization counterpart to `recordWorkerCycleOutcome`: called when a
 * worker finishes one organization's run. Keeps the existing summary fields
 * (`lastActivePollAt`, `lastReconciliationAt` and their failure counts — what
 * the Monitoring page, health endpoint and watchdog read) meaningful now that
 * there is no whole-deployment cycle to stamp them with.
 *
 *  - the timestamp only ever moves forward (several workers finish out of
 *    order), and records when the run *started*, like the single-lane cycle;
 *  - a reconciliation run also counts as an active poll — it did the same work;
 *  - the failure count is the number of organizations currently failing,
 *    read from the work state rather than accumulated here, and is refreshed
 *    for both kinds on every run.
 */
export async function recordOrganizationRunOutcome(
  prisma: PrismaClient,
  kind: "active" | "reconciliation",
  startedAt: Date,
): Promise<void> {
  await recordWorkerHeartbeat(prisma);
  const failing = await prisma.organizationWorkState.count({ where: { consecutiveFailures: { gt: 0 } } });

  await prisma.workerSettings.updateMany({
    where: { id: SINGLETON_ID, OR: [{ lastActivePollAt: null }, { lastActivePollAt: { lt: startedAt } }] },
    data: { lastActivePollAt: startedAt },
  });
  // One deployment-wide number, written to both fields on every run: "how many
  // organizations are failing right now". Refreshing only the field of the kind
  // that just ran would leave the other one stale — and since the derived status
  // is Degraded if *either* is non-zero, a stale reconciliation count would keep
  // the worker Degraded for up to a whole reconciliation interval after the last
  // failure was fixed.
  await prisma.workerSettings.updateMany({
    where: { id: SINGLETON_ID },
    data: { lastActivePollFailures: failing, lastReconciliationFailures: failing },
  });

  if (kind === "reconciliation") {
    await prisma.workerSettings.updateMany({
      where: { id: SINGLETON_ID, OR: [{ lastReconciliationAt: null }, { lastReconciliationAt: { lt: startedAt } }] },
      data: { lastReconciliationAt: startedAt },
    });
  }
}

/**
 * When the next active poll / reconciliation will actually happen, from the
 * per-organization work state. With per-organization schedules there is no
 * single armed timer, so this is the earliest moment any organization becomes
 * claimable for that kind of work:
 *
 *  - organizations under a live lease are being processed right now, and their
 *    stored due time is the run in progress, not a future one — they are left
 *    out (unless every organization is busy, then the stored times are all there is);
 *  - a due time already in the past means "as soon as a worker slot frees",
 *    so it is reported as *now*, never as a moment before the last check.
 *
 * Null when no organization has a work-state row yet.
 */
export async function getWorkStateNextRuns(
  prisma: PrismaClient,
): Promise<{ nextActivePollAt: Date | null; nextReconciliationAt: Date | null }> {
  const rows = await prisma.$queryRaw<{ active: Date | null; reconciliation: Date | null }[]>`
    SELECT
      GREATEST(now(), COALESCE(
        MIN("activeNextDueAt") FILTER (WHERE "leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now()),
        MIN("activeNextDueAt"))) AS "active",
      GREATEST(now(), COALESCE(
        MIN("reconciliationNextDueAt") FILTER (WHERE "leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now()),
        MIN("reconciliationNextDueAt"))) AS "reconciliation"
    FROM "organization_work_states"
    HAVING count(*) > 0`;
  const row = rows[0];
  return { nextActivePollAt: row?.active ?? null, nextReconciliationAt: row?.reconciliation ?? null };
}
