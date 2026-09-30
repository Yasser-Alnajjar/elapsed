import { getOrCreateWorkerSettings, type PrismaClient, type WorkerSettingsRecord } from "@sla/db";

/**
 * Short-lived cache over `getOrCreateWorkerSettings` (an upsert — a write on
 * every call). Every organization run needs the intervals at least twice
 * (lookback sizing at the start, scheduling at the end), and with several
 * organizations finishing per second that would be most of the worker's
 * traffic for a row that changes when an operator edits it. Two seconds keeps
 * "a Monitoring change applies to the next run" true in practice.
 */
export function createSettingsReader(prisma: PrismaClient, ttlMs = 2_000, now: () => number = Date.now) {
  let cached: { at: number; value: Promise<WorkerSettingsRecord> } | null = null;
  return function read(): Promise<WorkerSettingsRecord> {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    const value = getOrCreateWorkerSettings(prisma);
    cached = { at: now(), value };
    // Don't cache a failure.
    value.catch(() => {
      if (cached?.value === value) cached = null;
    });
    return value;
  };
}
