"use client";

import { useEffect, useState } from "react";

import { formatSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

// A page like /at-risk can render dozens of these clocks at once — one
// `setInterval` per clock was measurable jank (performance-plan.md Phase 2
// item 4). Every mounted `CountdownClock` instead subscribes to a single
// module-level 1s ticker, started on first subscriber and stopped once the
// last one unmounts.
const tickListeners = new Set<() => void>();
let tickIntervalId: ReturnType<typeof setInterval> | null = null;

function subscribeToTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickIntervalId === null) {
    tickIntervalId = setInterval(() => {
      for (const tick of tickListeners) tick();
    }, 1000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickIntervalId !== null) {
      clearInterval(tickIntervalId);
      tickIntervalId = null;
    }
  };
}

/**
 * Ticks a commitment's remaining time down once a second between server
 * refreshes, purely for display — `remainingMinutes` (recomputed on every
 * `SlaAutoRefreshProvider` refresh) stays the source of truth and resyncs
 * this clock whenever it changes.
 */
export function CountdownClock({
  remainingMinutes,
  className,
}: {
  remainingMinutes: number;
  className?: string;
}) {
  const [seconds, setSeconds] = useState(() => Math.round(remainingMinutes * 60));

  useEffect(() => {
    setSeconds(Math.round(remainingMinutes * 60));
  }, [remainingMinutes]);

  useEffect(() => subscribeToTick(() => setSeconds((s) => s - 1)), []);

  const overdue = seconds < 0;

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {overdue ? `${formatSeconds(-seconds)} over` : formatSeconds(seconds)}
    </span>
  );
}
