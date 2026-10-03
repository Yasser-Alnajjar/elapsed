"use client";

import { useEffect, useState } from "react";

export type CooldownReason = "RATE_LIMITED" | "AUTH_THROTTLED";

/**
 * A server-imposed sign-in cooldown, counted down once a second until it
 * clears itself. `start` begins one from the server's `retryAfterSeconds`.
 */
export function useSignInCooldown() {
  // Seconds remaining in a server-imposed cooldown.
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null);
  const [cooldownReason, setCooldownReason] = useState<CooldownReason | null>(
    null,
  );

  useEffect(() => {
    if (cooldownSeconds === null) return;

    if (cooldownSeconds <= 0) {
      setCooldownSeconds(null);
      setCooldownReason(null);
      return;
    }

    const timer = setTimeout(
      () => setCooldownSeconds((seconds) => (seconds ?? 1) - 1),
      1000,
    );

    return () => clearTimeout(timer);
  }, [cooldownSeconds]);

  const start = (reason: CooldownReason, seconds: number) => {
    setCooldownReason(reason);
    setCooldownSeconds(seconds);
  };

  return {
    cooldownSeconds,
    cooldownReason,
    inCooldown: cooldownSeconds !== null && cooldownSeconds > 0,
    start,
  };
}
