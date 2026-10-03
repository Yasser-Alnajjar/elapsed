"use client";

import { useSyncExternalStore } from "react";
import {
  getLiveStatus,
  getServerLiveStatusSnapshot,
  subscribeLiveStatus,
} from "@/lib/live-status-store";
import type { LiveConnectionStatus } from "@/lib/live-data-connection";
import { TONE_DOT, TONE_TEXT, type Tone } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

const LABEL: Record<LiveConnectionStatus, string> = {
  connected: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

const TONE: Record<LiveConnectionStatus, Tone> = {
  connected: "success",
  reconnecting: "warning",
  offline: "danger",
};

const TITLE: Record<LiveConnectionStatus, string> = {
  connected: "Live updates connected — the dashboard refreshes automatically when data changes.",
  reconnecting: "Live updates interrupted — reconnecting. Pages may need a manual refresh in the meantime.",
  offline: "Live updates are down. Pages will keep working, but won't refresh automatically until this recovers.",
};

/**
 * Global, compact indicator of whether `LiveDataProvider`'s single SSE
 * connection (and, through it, the web process's dedicated Postgres `LISTEN`
 * connection — see the Monitoring page for that detail) is actually working
 * right now. Reads `live-status-store`, never infers "Live" from having
 * mounted — the store starts (and `useSyncExternalStore`'s server snapshot
 * always is) "reconnecting" until a real event says otherwise.
 */
export function LiveStatusBadge() {
  const status = useSyncExternalStore(
    subscribeLiveStatus,
    getLiveStatus,
    getServerLiveStatusSnapshot,
  );

  return (
    <div
      className="flex items-center gap-1.5 rounded border border-border-subtle bg-surface-container px-2.5 py-1"
      title={TITLE[status]}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          TONE_DOT[TONE[status]],
          status !== "offline" && "animate-pulse",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "font-mono text-xxs font-semibold uppercase tracking-wider",
          TONE_TEXT[TONE[status]],
        )}
      >
        {LABEL[status]}
      </span>
    </div>
  );
}
