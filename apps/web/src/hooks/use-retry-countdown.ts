"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client-side countdown for a server-imposed retry/lock duration. It keeps
 * the absolute deadline (not a decrementing counter), so a throttled
 * background tab or a re-render can't drift it. Idle on first render, so
 * server and client markup match; the deadline is only set from a response.
 * `remainingSeconds` is 0 once it elapses, and the interval is cleared on
 * unmount.
 */
export function useRetryCountdown() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (deadline === null) return;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) setDeadline(null);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const start = useCallback((seconds: number) => {
    setRemainingSeconds(Math.max(0, Math.ceil(seconds)));
    setDeadline(Date.now() + seconds * 1000);
  }, []);

  return { remainingSeconds, active: remainingSeconds > 0, start };
}
