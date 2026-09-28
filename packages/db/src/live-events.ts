import pg from "pg";
import { createLogger } from "@sla/logger";

const logger = createLogger({ scope: "live_events" });

/**
 * Single Postgres NOTIFY channel for the whole app. The payload carries the
 * tenant scope and a hint of what changed; it deliberately never carries the
 * changed rows themselves (browsers re-fetch through the normal server-side
 * data path, which stays the single source of truth — see LiveDataProvider).
 */
export const LIVE_DATA_CHANNEL = "sla_live_data";

export type LiveDataEvent = {
  type: "data.updated";
  organizationId: string;
  /** Optional hint of what changed (e.g. "cases", "commitments"); consumers may ignore it and refresh anyway. */
  domains?: string[];
};

function isLiveDataEvent(value: unknown): value is LiveDataEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "data.updated" &&
    typeof (value as { organizationId?: unknown }).organizationId === "string"
  );
}

/**
 * Queues a `NOTIFY` on `client`'s current transaction. Postgres only
 * delivers a transactional NOTIFY to listeners once that transaction
 * actually commits — a rollback silently discards it — so calling this
 * inside a caller's own `BEGIN`/`COMMIT` (e.g. `withOrganizationSlaLock`) is
 * what keeps "browsers get notified" and "the write actually landed" the
 * same fact, with no separate outbox/dual-write to keep in sync.
 */
export async function publishLiveDataEvent(
  client: Pick<pg.Client, "query">,
  event: LiveDataEvent,
): Promise<void> {
  await client.query("SELECT pg_notify($1, $2)", [
    LIVE_DATA_CHANNEL,
    JSON.stringify(event),
  ]);
}

export interface LiveDataSubscription {
  close(): Promise<void>;
  /** Current snapshot of the dedicated `LISTEN` connection's health. */
  getStatus(): LiveListenerStatus;
}

/**
 * "connected": the dedicated `LISTEN` connection is up and re-issued.
 * "reconnecting": it was just lost (or hasn't connected yet) and a retry is
 * in flight or scheduled. "offline": retries have failed
 * `OFFLINE_AFTER_FAILURES` times in a row — still retrying underneath, but
 * this has gone on long enough that it's no longer "a blip".
 */
export type LiveListenerConnectionState = "connected" | "reconnecting" | "offline";

export interface LiveListenerStatus {
  state: LiveListenerConnectionState;
  /** When the connection last successfully completed `connect()` + `LISTEN`. */
  lastConnectedAt: Date | null;
  /** When the most recent error/lost-connection/failed-attempt was observed. */
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  /** How many times a lost connection has been successfully re-established (never counts the first, initial connect). */
  reconnectCount: number;
}

function initialStatus(): LiveListenerStatus {
  return {
    state: "reconnecting",
    lastConnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    reconnectCount: 0,
  };
}

const RECONNECT_DELAY_MS = 2_000;

/** How often the dedicated `LISTEN` connection round-trips a trivial query, so a silently dead one is noticed. */
const HEARTBEAT_MS = 30_000;

/** Consecutive failed reconnect *attempts* (not just "connection lost" events) before the state escalates from "reconnecting" to "offline". */
const OFFLINE_AFTER_FAILURES = 3;

/**
 * One dedicated, unpooled `LISTEN` connection per process (never
 * `prisma.$queryRaw`/the pooled adapter — same reasoning as
 * `advisory-lock.ts`: a pooled connection can be recycled out from under a
 * session-scoped `LISTEN`). Reconnects with a fixed backoff on any
 * connection loss (Postgres restart, network blip) and re-issues `LISTEN`,
 * so callers never have to think about the connection lifecycle — they just
 * get `onEvent` calls for as long as the process is up.
 *
 * A `LISTEN` connection that never sends application traffic can be dropped
 * silently by a NAT/load balancer/firewall idle timeout: the socket dies
 * without `pg` ever emitting `error` or `end`, so nothing here would notice
 * and no reconnect would ever fire. Guarded against the same way
 * `leader-lock.ts` guards its advisory-lock connection: a periodic trivial
 * query round-trip, treated as a lost connection if it fails.
 *
 * This is a per-process fan-in, not the source of truth: every process that
 * calls this receives every event via Postgres itself, so it stays correct
 * whether there's one web process or several (no in-memory bus to keep in
 * sync across them).
 */
export function subscribeToLiveData(
  onEvent: (event: LiveDataEvent) => void,
  options: {
    connectionString?: string;
    heartbeatMs?: number;
    /** Called whenever `status.state` actually changes — never for a same-state update, so a caller forwarding this to, say, an SSE stream never emits a duplicate. */
    onStatusChange?: (status: LiveListenerStatus) => void;
  } = {},
): LiveDataSubscription {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL!;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  let client: pg.Client | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let lost = false;
  let consecutiveFailedAttempts = 0;
  const status = initialStatus();

  const setState = (state: LiveListenerConnectionState) => {
    if (status.state === state) return;
    status.state = state;
    options.onStatusChange?.({ ...status });
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      lost = false;
      void connect();
    }, RECONNECT_DELAY_MS);
  };

  const handleLost = (error: Error) => {
    if (lost) return;
    lost = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    logger.error("live_events_connection_lost", { error: error.message });
    status.lastErrorAt = new Date();
    status.lastErrorMessage = error.message;
    setState("reconnecting");
    // The dead connection may still be sitting in `client`; drop the
    // reference here (rather than relying on the caller's own `end()`/`error`
    // sequencing) so a stale socket is never mistaken for a live one, and
    // end it defensively in case the failure wasn't already a full teardown.
    const stale = client;
    client = null;
    if (stale) void stale.end().catch(() => undefined);
    scheduleReconnect();
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    const candidate = new pg.Client({ connectionString, keepAlive: true });
    candidate.on("error", handleLost);
    candidate.on("end", () => handleLost(new Error("live events connection ended")));
    candidate.on("notification", (message) => {
      if (message.channel !== LIVE_DATA_CHANNEL || !message.payload) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.payload);
      } catch {
        logger.error("live_events_invalid_payload", { payload: message.payload });
        return;
      }
      if (!isLiveDataEvent(parsed)) {
        logger.error("live_events_invalid_payload", { payload: message.payload });
        return;
      }
      onEvent(parsed);
    });

    try {
      await candidate.connect();
      await candidate.query(`LISTEN ${LIVE_DATA_CHANNEL}`);
      if (stopped) {
        await candidate.end();
        return;
      }
      client = candidate;
      lost = false;
      const wasEverConnected = status.lastConnectedAt !== null;
      const isReconnect = wasEverConnected && status.state !== "connected";
      consecutiveFailedAttempts = 0;
      status.lastConnectedAt = new Date();
      if (isReconnect) status.reconnectCount += 1;
      setState("connected");
      logger.info("live_events_connected", {});
      heartbeatTimer = setInterval(() => {
        candidate.query("SELECT 1").catch((error: unknown) => {
          handleLost(error instanceof Error ? error : new Error(String(error)));
        });
      }, heartbeatMs);
    } catch (error) {
      // `connect()` throwing leaves no open socket; `query()` throwing after
      // a successful `connect()` can leave one, and `candidate` was never
      // assigned to `client` — end it here so a failed `LISTEN` can't leak a
      // connection on every retry. Strip the listeners first: `end()` itself
      // fires `end`, and this candidate never became `client`, so letting it
      // reach `handleLost` would double-count this single failed attempt.
      candidate.removeAllListeners();
      await candidate.end().catch(() => undefined);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("live_events_connect_failed", { error: err.message });
      consecutiveFailedAttempts += 1;
      status.lastErrorAt = new Date();
      status.lastErrorMessage = err.message;
      setState(consecutiveFailedAttempts >= OFFLINE_AFTER_FAILURES ? "offline" : "reconnecting");
      scheduleReconnect();
    }
  };

  void connect();

  return {
    async close() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      const held = client;
      client = null;
      if (held) await held.end().catch(() => undefined);
    },
    getStatus() {
      return { ...status };
    },
  };
}
