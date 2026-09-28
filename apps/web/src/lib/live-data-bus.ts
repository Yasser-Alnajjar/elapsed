import "server-only";
import { subscribeToLiveData, type LiveDataEvent, type LiveListenerStatus } from "@sla/db";

type Listener = (event: LiveDataEvent) => void;
type StatusListener = (status: LiveDataStatus) => void;

/** `LiveListenerStatus` plus this process's own view of when data last actually flowed — the bus's addition on top of what the dedicated `LISTEN` connection itself knows. */
export interface LiveDataStatus extends LiveListenerStatus {
  lastEventAt: Date | null;
}

export interface LiveDataBus {
  /** Delivers every future event for `organizationId` to `listener` until the returned function is called. */
  subscribe(organizationId: string, listener: Listener): () => void;
  /** Current snapshot of the dedicated `LISTEN` connection's health, for the Monitoring page and a new SSE subscriber's first status push. */
  getStatus(): LiveDataStatus;
  /** Delivers every future status *transition* (never a same-state duplicate — see `subscribeToLiveData`) until the returned function is called. */
  subscribeToStatus(listener: StatusListener): () => void;
}

function createLiveDataBus(): LiveDataBus {
  const listenersByOrg = new Map<string, Set<Listener>>();
  const statusListeners = new Set<StatusListener>();
  let lastEventAt: Date | null = null;

  const subscription = subscribeToLiveData(
    (event) => {
      lastEventAt = new Date();
      const listeners = listenersByOrg.get(event.organizationId);
      if (!listeners) return;
      for (const listener of listeners) listener(event);
    },
    {
      onStatusChange: () => {
        const snapshot = getStatus();
        for (const listener of statusListeners) listener(snapshot);
      },
    },
  );

  function getStatus(): LiveDataStatus {
    return { ...subscription.getStatus(), lastEventAt };
  }

  return {
    subscribe(organizationId, listener) {
      let listeners = listenersByOrg.get(organizationId);
      if (!listeners) {
        listeners = new Set();
        listenersByOrg.set(organizationId, listeners);
      }
      listeners.add(listener);

      return () => {
        listeners!.delete(listener);
        if (listeners!.size === 0) listenersByOrg.delete(organizationId);
      };
    },
    getStatus,
    subscribeToStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
  };
}

// Stashed on `globalThis`, matching `getPrismaClient` in @sla/db: `next dev`
// re-evaluates this module on every hot reload within the same process, and
// this must still open exactly one dedicated `LISTEN` connection per
// process, not one per reload.
const globalForLiveBus = globalThis as unknown as { __slaLiveBus?: LiveDataBus };

export function getLiveDataBus(): LiveDataBus {
  if (!globalForLiveBus.__slaLiveBus) {
    globalForLiveBus.__slaLiveBus = createLiveDataBus();
  }
  return globalForLiveBus.__slaLiveBus;
}
