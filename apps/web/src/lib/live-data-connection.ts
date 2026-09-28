/**
 * Minimal surface of `EventSource` this module needs, so tests can pass a
 * fake without touching the DOM (this repo has no jsdom/testing-library
 * dependency, and this doesn't need one).
 */
export interface EventSourceLike {
  addEventListener(type: string, listener: () => void): void;
  close(): void;
}

export interface LiveDataConnectionOptions {
  url: string;
  onRefresh: () => void;
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

  const scheduleRefresh = () => {
    if (coalesceTimer) return;
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null;
      options.onRefresh();
    }, coalesceMs);
  };

  const source = createEventSource(options.url);
  source.addEventListener("data.updated", scheduleRefresh);

  return {
    close() {
      if (coalesceTimer) clearTimeout(coalesceTimer);
      source.close();
    },
  };
}
