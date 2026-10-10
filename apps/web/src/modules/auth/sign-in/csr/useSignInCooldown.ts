"use client";

import { useState } from "react";
import { useRetryCountdown } from "@/hooks/use-retry-countdown";

export type CooldownReason = "RATE_LIMITED" | "AUTH_THROTTLED";

/**
 * A server-imposed sign-in cooldown, counted down until it clears itself.
 * `start` begins one from the server's `retryAfterSeconds`.
 */
export function useSignInCooldown() {
  const countdown = useRetryCountdown();
  const [cooldownReason, setCooldownReason] = useState<CooldownReason | null>(
    null,
  );

  const start = (reason: CooldownReason, seconds: number) => {
    setCooldownReason(reason);
    countdown.start(seconds);
  };

  return {
    cooldownSeconds: countdown.remainingSeconds,
    cooldownReason: countdown.active ? cooldownReason : null,
    inCooldown: countdown.active,
    start,
  };
}
