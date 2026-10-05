"use client";

import { useEffect, useState } from "react";
import type { ClockState } from "@sla/core";

/** What the countdown needs from an evaluation: shared by case details and At-Risk so both show the same runway. */
export interface LiveClock {
  clockState: ClockState;
  effectiveDueAt: string | null;
  remainingSeconds: number;
}

function getLiveRemainingSeconds(c: LiveClock): number {
  if (c.clockState !== "running" || !c.effectiveDueAt)
    return c.remainingSeconds;
  return Math.floor((new Date(c.effectiveDueAt).getTime() - Date.now()) / 1000);
}

/**
 * A commitment's remaining seconds, ticking once a second while its clock
 * runs. Starts from the server snapshot so SSR and the first client render
 * agree; the effect then switches to the live value.
 */
export function useLiveRemaining(c: LiveClock): number {
  const [remaining, setRemaining] = useState(c.remainingSeconds);

  useEffect(() => {
    setRemaining(getLiveRemainingSeconds(c));
    if (c.clockState !== "running" || !c.effectiveDueAt) return;
    const id = window.setInterval(
      () => setRemaining(getLiveRemainingSeconds(c)),
      1000,
    );
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.effectiveDueAt, c.clockState, c.remainingSeconds]);

  return remaining;
}
