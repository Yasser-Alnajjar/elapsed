import "server-only";
import { getLiveDataBus } from "./live-data-bus";
import type { LiveDataStatusView } from "./types/live-data-status";

/**
 * Read model for the Monitoring page's "Live Data" card: this process's own
 * dedicated Postgres `LISTEN` connection's health, straight off
 * `getLiveDataBus()` — no separate polling or storage, same in-memory
 * singleton `/api/live` already reads from. Not `React.cache`-wrapped like
 * `getWorkerMonitoringData`: this is a synchronous in-memory read, not a
 * database round trip, so memoizing it within a request buys nothing.
 */
export function getLiveDataStatusView(): LiveDataStatusView {
  const status = getLiveDataBus().getStatus();
  return {
    state: status.state,
    lastConnectedAt: status.lastConnectedAt?.toISOString() ?? null,
    lastEventAt: status.lastEventAt?.toISOString() ?? null,
    lastErrorAt: status.lastErrorAt?.toISOString() ?? null,
    lastErrorMessage: status.lastErrorMessage,
    reconnectCount: status.reconnectCount,
  };
}
