/**
 * Minimal surface of `EventSource` this module needs, so tests can pass a
 * fake without touching the DOM (this repo has no jsdom/testing-library
 * dependency, and this doesn't need one).
 */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
}

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
}

export interface LiveDataConnection {
  close(): void;
}

const DEFAULT_COALESCE_MS = 500;

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
 * Owns exactly one SSE connection and turns its `data.updated` events into
 * coalesced `onRefresh()` calls. No polling, no timers beyond the one
 * short-lived coalescing timeout per burst — reconnection after a dropped
 * connection is `EventSource`'s own native behavior, not reimplemented here.
 */
export function connectLiveData(
  options: LiveDataConnectionOptions,
): LiveDataConnection {
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
  const createEventSource = options.createEventSource ?? defaultCreateEventSource;

  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let sseOpen = false;
  let serverState: LiveConnectionStatus | null = null;

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

  const source = createEventSource(options.url);
  source.addEventListener("data.updated", scheduleRefresh);
  source.addEventListener("open", () => {
    sseOpen = true;
    options.onTransportChange?.(true);
    emitStatus();
  });
  source.addEventListener("error", () => {
    sseOpen = false;
    options.onTransportChange?.(false);
    emitStatus();
  });
  source.addEventListener("listener.status", (event) => {
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
  });

  // Report the initial state synchronously — "reconnecting" (via `!sseOpen`)
  // until the transport actually opens, never a fabricated "connected".
  emitStatus();

  return {
    close() {
      if (coalesceTimer) clearTimeout(coalesceTimer);
      source.close();
    },
  };
}
