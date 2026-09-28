import type { LiveConnectionStatus } from "@/lib/live-data-connection";

/**
 * Tiny module-level pub-sub so `LiveDataProvider` (mounted once, invisible,
 * owning the one SSE connection) and `LiveStatusBadge` (rendered in the
 * header, wherever that markup lives) can share the live connection's status
 * without either needing to own the other or thread props through the
 * layout. One instance per browser tab — nothing here is shared across tabs,
 * users, or the server, and nothing here polls: it only ever changes in
 * response to `connectLiveData`'s own `onStatusChange`.
 */
let currentStatus: LiveConnectionStatus = "reconnecting";
/** This tab's own SSE transport, independent of `currentStatus` — see `connectLiveData`'s `onTransportChange`. */
let currentSseOpen = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function setLiveStatus(status: LiveConnectionStatus): void {
  if (status === currentStatus) return;
  currentStatus = status;
  notify();
}

export function getLiveStatus(): LiveConnectionStatus {
  return currentStatus;
}

/** Never "connected" — matches `LiveDataProvider`'s pre-mount state, so `useSyncExternalStore`'s server snapshot can't claim liveness the client hasn't confirmed yet. */
export function getServerLiveStatusSnapshot(): LiveConnectionStatus {
  return "reconnecting";
}

export function setSseTransportOpen(open: boolean): void {
  if (open === currentSseOpen) return;
  currentSseOpen = open;
  notify();
}

export function getSseTransportOpen(): boolean {
  return currentSseOpen;
}

export function getServerSseTransportSnapshot(): boolean {
  return false;
}

export function subscribeLiveStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
