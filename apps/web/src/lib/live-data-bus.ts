import "server-only";
import { subscribeToLiveData, type LiveDataEvent } from "@sla/db";

type Listener = (event: LiveDataEvent) => void;

export interface LiveDataBus {
  /** Delivers every future event for `organizationId` to `listener` until the returned function is called. */
  subscribe(organizationId: string, listener: Listener): () => void;
}

function createLiveDataBus(): LiveDataBus {
  const listenersByOrg = new Map<string, Set<Listener>>();

  subscribeToLiveData((event) => {
    const listeners = listenersByOrg.get(event.organizationId);
    if (!listeners) return;
    for (const listener of listeners) listener(event);
  });

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
