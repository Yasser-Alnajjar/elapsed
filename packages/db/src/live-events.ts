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
}

const RECONNECT_DELAY_MS = 2_000;

/**
 * One dedicated, unpooled `LISTEN` connection per process (never
 * `prisma.$queryRaw`/the pooled adapter — same reasoning as
 * `advisory-lock.ts`: a pooled connection can be recycled out from under a
 * session-scoped `LISTEN`). Reconnects with a fixed backoff on any
 * connection loss (Postgres restart, network blip) and re-issues `LISTEN`,
 * so callers never have to think about the connection lifecycle — they just
 * get `onEvent` calls for as long as the process is up.
 *
 * This is a per-process fan-in, not the source of truth: every process that
 * calls this receives every event via Postgres itself, so it stays correct
 * whether there's one web process or several (no in-memory bus to keep in
 * sync across them).
 */
export function subscribeToLiveData(
  onEvent: (event: LiveDataEvent) => void,
  options: { connectionString?: string } = {},
): LiveDataSubscription {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL!;
  let client: pg.Client | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RECONNECT_DELAY_MS);
  };

  const handleLost = (error: Error) => {
    logger.error("live_events_connection_lost", { error: error.message });
    client = null;
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
      logger.info("live_events_connected", {});
    } catch (error) {
      logger.error("live_events_connect_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleReconnect();
    }
  };

  void connect();

  return {
    async close() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const held = client;
      client = null;
      if (held) await held.end().catch(() => undefined);
    },
  };
}
