/**
 * Minimal surface of `EventSource` this module needs, so tests can pass a
 * fake without touching the DOM (this repo has no jsdom/testing-library
 * dependency, and this doesn't need one).
 */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
  /** 0 CONNECTING, 1 OPEN, 2 CLOSED. Optional so test fakes needn't model it; absent is treated as "still retrying natively". */
  readonly readyState?: number;
}

/** `EventSource.CLOSED`: the browser has given up (non-200 / wrong content type) and will never retry on its own. */
const EVENT_SOURCE_CLOSED = 2;

/**
 * What the header badge and the Monitoring page's "SSE connection" line
 * actually need — never inferred from "the page loaded", only from real
 * `EventSource` lifecycle events and the server's own `listener.status`
 * pushes (see `route.ts`'s `statusSseEvent`).
 */
export type LiveConnectionStatus = "connected" | "reconnecting" | "offline";

export interface LiveDataConnectionOptions {
  url: string;
  onRefresh: () => void;
  /**
   * Fires whenever the combined status (this tab's SSE transport + the
   * server's Postgres `LISTEN` health) changes. Never on a timer — only in
   * response to a real `open`/`error`/`listener.status` event.
   */
  onStatusChange?: (status: LiveConnectionStatus) => void;
  /** Fires whenever this tab's own SSE transport opens or drops — independent of the combined/server status, for a diagnostic view (e.g. the Monitoring page) that wants to tell "my transport is down" apart from "the server's listener is down". */
  onTransportChange?: (open: boolean) => void;
  /** Defaults to the real `EventSource`; overridable for tests. */
  createEventSource?: (url: string) => EventSourceLike;
  /**
   * Several worker-published events can land within milliseconds of each
   * other (e.g. one cycle touching many organizations' data in quick
   * succession isn't possible per-org, but a burst of webhook deliveries for
   * the same org is) — collapsed into a single `onRefresh()` per window
   * instead of one per event, so a burst never queues up N overlapping
   * `router.refresh()` calls.
   */
  coalesceMs?: number;
  /**
   * Backoff for re-creating an `EventSource` the browser has permanently
   * closed (e.g. `/api/live` answered 401/5xx): doubles from `reconnectBaseMs`
   * up to `reconnectMaxMs`, reset by a successful open.
   */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export interface LiveDataConnection {
  close(): void;
}

const DEFAULT_COALESCE_MS = 500;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

function defaultCreateEventSource(url: string): EventSourceLike {
  return new EventSource(url);
}

/**
 * Combines this tab's own SSE transport state with the server's last-known
 * Postgres `LISTEN` state into the single three-way status the UI shows.
 *
 * `sseOpen: false` always wins as "reconnecting": without a live transport
 * this tab can't hear about anything, including a stale "connected" it
 * received before the transport dropped — showing that would be exactly the
 * "Live merely because the page loaded" mistake this exists to avoid.
 * "offline" is never inferred purely from a transient SSE blip (the native
 * `EventSource` retries every couple of seconds on its own and recovers most
 * blips before a person would notice); it only ever reflects the server's
 * own sustained-failure detection, once the transport is back to relay it.
 */
export function deriveLiveStatus(
  sseOpen: boolean,
  serverState: LiveConnectionStatus | null,
): LiveConnectionStatus {
  if (!sseOpen) return "reconnecting";
  return serverState ?? "reconnecting";
}

/**
 * Owns exactly one SSE connection at a time and turns its `data.updated`
 * events into coalesced `onRefresh()` calls. No polling: a dropped connection
 * is retried by `EventSource` itself, and only when the browser gives up on it
 * for good (`readyState === CLOSED`, e.g. a 401/5xx response, which it never
 * retries) is a fresh one created, after a bounded exponential backoff.
 *
 * Events can be missed while disconnected, so the first successful `open`
 * after any error requests one catch-up refresh — through the same coalescing
 * as `data.updated`, so a recovery and an event landing together still cost a
 * single `onRefresh()`. The database stays the source of truth; nothing is
 * replayed.
 */
export function connectLiveData(
  options: LiveDataConnectionOptions,
): LiveDataConnection {
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
  const reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
  const reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
  const createEventSource = options.createEventSource ?? defaultCreateEventSource;

  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let current: EventSourceLike | null = null;
  let closed = false;
  let sseOpen = false;
  let serverState: LiveConnectionStatus | null = null;
  let needsCatchUp = false;
  let failedAttempts = 0;

  const scheduleRefresh = () => {
    if (coalesceTimer) return;
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null;
      options.onRefresh();
    }, coalesceMs);
  };

  const emitStatus = () => {
    options.onStatusChange?.(deriveLiveStatus(sseOpen, serverState));
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** failedAttempts);
    failedAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  };

  function open(): void {
    if (closed || current) return;
    const source = createEventSource(options.url);
    current = source;
    // A source that has been replaced or closed must never affect the live
    // one: every handler checks it is still the current source.
    const live = (handler: (event: { data?: string }) => void) => (event: { data?: string }) => {
      if (current === source) handler(event);
    };

    source.addEventListener("data.updated", live(scheduleRefresh));
    source.addEventListener(
      "open",
      live(() => {
        sseOpen = true;
        failedAttempts = 0;
        options.onTransportChange?.(true);
        emitStatus();
        if (needsCatchUp) {
          needsCatchUp = false;
          scheduleRefresh();
        }
      }),
    );
    source.addEventListener(
      "error",
      live(() => {
        sseOpen = false;
        needsCatchUp = true;
        options.onTransportChange?.(false);
        emitStatus();
        if (source.readyState === EVENT_SOURCE_CLOSED) {
          // The browser will not retry this one: replace it ourselves.
          source.close();
          current = null;
          scheduleReconnect();
        }
      }),
    );
    source.addEventListener(
      "listener.status",
      live((event) => {
        try {
          const parsed = JSON.parse(event.data ?? "") as { state?: unknown };
          if (
            parsed.state === "connected" ||
            parsed.state === "reconnecting" ||
            parsed.state === "offline"
          ) {
            serverState = parsed.state;
          }
        } catch {
          // Malformed payload: keep the last known server state rather than
          // guessing.
        }
        emitStatus();
      }),
    );
  }

  open();

  // Report the initial state synchronously — "reconnecting" (via `!sseOpen`)
  // until the transport actually opens, never a fabricated "connected".
  emitStatus();

  return {
    close() {
      closed = true;
      if (coalesceTimer) clearTimeout(coalesceTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      coalesceTimer = null;
      reconnectTimer = null;
      const source = current;
      current = null;
      source?.close();
    },
  };
}
