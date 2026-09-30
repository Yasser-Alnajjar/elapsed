import http from "node:http";
import { deriveWorkerStatus, getOrCreateWorkerSettings, getWorkStateSummary, type PrismaClient } from "@sla/db";
import type { WorkLoopStats } from "./work-loop";

/** What the health endpoint reports about *this* process — supplied by `index.ts`, since only it knows the loop. */
export interface WorkerHealthInfo {
  workerId: string;
  /** False until the work loop has been started. */
  started: boolean;
  /** Whether this worker currently holds the watchdog election (the only remaining singleton role). */
  watchdogLeader: boolean;
  /** Milliseconds since this process's work loop last made progress. */
  msSinceLastTick: number;
  loop: WorkLoopStats | null;
  organizationConcurrency: number;
  databasePoolMax: number;
}

/** The loop ticks at least once per claim poll; this long without one means it is wedged. */
const LOOP_STALLED_AFTER_MS = 60_000;

export interface WorkerHealthServer {
  close(): Promise<void>;
}

/**
 * The worker had no HTTP surface at all before this (roadmap step 29) — a
 * bare `setTimeout` loop with only stdout logs. This is deliberately just a
 * liveness probe for Docker/an orchestrator to restart on, not a general
 * API: no auth (nothing sensitive is returned — timestamps and counts, no
 * credentials), no routing library, just `node:http`, matching this
 * package's zero-framework style.
 */
export function startHealthServer(prisma: PrismaClient, port: number, getInfo: () => WorkerHealthInfo): WorkerHealthServer {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || (req.url !== "/health" && req.url !== "/healthz")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    void handleHealthRequest(prisma, res, getInfo());
  });

  server.listen(port, () => {
    console.log(JSON.stringify({ event: "health_server_listening", port }));
  });

  server.on("error", (error) => {
    console.error(JSON.stringify({ event: "health_server_error", error: error.message }));
  });

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleHealthRequest(prisma: PrismaClient, res: http.ServerResponse, info: WorkerHealthInfo): Promise<void> {
  // Liveness is about *this* process. There is no standby any more — every
  // worker does real work — so the old "standby is healthy by design" case is
  // gone, and what can be wrong is that the work loop never started or has
  // stopped making progress: 503, so the orchestrator restarts this process
  // (its leases expire and another worker takes the organizations).
  if (!info.started) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "starting", workerId: info.workerId }));
    return;
  }
  if (info.msSinceLastTick > LOOP_STALLED_AFTER_MS) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "stalled", workerId: info.workerId, msSinceLastTick: Math.round(info.msSinceLastTick) }));
    return;
  }

  try {
    const settings = await getOrCreateWorkerSettings(prisma);
    const status = deriveWorkerStatus(settings);

    // "Successful" means the most recently *completed* run of that kind
    // recorded zero per-organization failures — a run that hit failures
    // still advances the heartbeat (see `deriveWorkerStatus`'s doc comment in
    // @sla/db) but doesn't count as a success here.
    const lastSuccessfulActivePollAt = settings.lastActivePollFailures === 0 ? settings.lastActivePollAt : null;
    const lastSuccessfulReconciliationAt =
      settings.lastReconciliationFailures === 0 ? settings.lastReconciliationAt : null;
    const lastSuccessfulCycleAt =
      [lastSuccessfulActivePollAt, lastSuccessfulReconciliationAt]
        .filter((date): date is Date => date !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    // Per-integration sync health (roadmap step 17's `lastSyncAt`/
    // `lastSyncError`), aggregated platform-wide — "surface an aggregate
    // 'last successful cycle' timestamp too" from this step's scope.
    const [integrationHealth, integrationsWithErrors, workState] = await Promise.all([
      prisma.integration.aggregate({
        _max: { lastSyncAt: true },
        where: { status: { not: "disconnected" } },
      }),
      prisma.integration.count({
        where: { status: { not: "disconnected" }, lastSyncError: { not: null } },
      }),
      getWorkStateSummary(prisma),
    ]);

    const body = {
      status,
      worker: {
        id: info.workerId,
        watchdogLeader: info.watchdogLeader,
        organizationConcurrency: info.organizationConcurrency,
        databasePoolMax: info.databasePoolMax,
        msSinceLastTick: Math.round(info.msSinceLastTick),
        loop: info.loop,
      },
      lastHeartbeatAt: settings.lastHeartbeatAt?.toISOString() ?? null,
      lastActivePollAt: settings.lastActivePollAt?.toISOString() ?? null,
      lastReconciliationAt: settings.lastReconciliationAt?.toISOString() ?? null,
      lastSuccessfulCycleAt: lastSuccessfulCycleAt?.toISOString() ?? null,
      // Per-organization freshness, deployment-wide (every worker's view is the same).
      workState: {
        ...workState,
        nextActiveDueAt: workState.nextActiveDueAt?.toISOString() ?? null,
        nextReconciliationDueAt: workState.nextReconciliationDueAt?.toISOString() ?? null,
      },
      integrations: {
        mostRecentSyncAt: integrationHealth._max.lastSyncAt?.toISOString() ?? null,
        withErrors: integrationsWithErrors,
      },
    };

    // "stopped" (no heartbeat at all — and this process writes one every few
    // seconds, so it means it can't reach the database) is the only case
    // worth an orchestrator restarting the container over — "degraded" means
    // the process is alive and working but a downstream integration is
    // failing, which a restart can't fix.
    res.writeHead(status === "stopped" ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  } catch (error) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }));
  }
}
