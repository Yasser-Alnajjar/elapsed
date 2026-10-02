"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Actions } from "@/actions/client";
import type { IntegrationProvider } from "@/lib/types/integrations";
import type { OnboardingStatus, ProviderOnboardingStatus } from "@/lib/types/onboarding";

interface UseOnboardingBackfillOptions {
  status: OnboardingStatus;
}

/**
 * Ticket sources and work trackers backfill as part of the guided flow. A code
 * host is an optional extra connected from its own card: it is never started
 * or waited on here.
 */
const isGuided = (p: ProviderOnboardingStatus) => p.role !== "code_host";

/** Connected, first backfill not finished, and not waiting on a reconnect. */
export const isBackfillRunning = (p: ProviderOnboardingStatus) =>
  isGuided(p) && p.connected && !p.backfillComplete && !p.reauthRequired;

export function useOnboardingBackfill({ status }: UseOnboardingBackfillOptions) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [error, setError] = useState<string | null>(null);

  const startedRef = useRef(new Set<IntegrationProvider>());

  const running = currentStatus.providers.filter(isBackfillRunning);
  // A stable key, so the effects re-run when the set changes, not on every poll.
  const runningKey = running.map((p) => p.provider).join(",");
  const anyRunning = running.length > 0;

  const refresh = useCallback(async () => {
    const progress = await Actions.Onboarding.getProgress();

    if (progress) {
      setCurrentStatus(progress);
    }

    return progress;
  }, []);

  useEffect(() => {
    for (const p of currentStatus.providers.filter(isBackfillRunning)) {
      if (startedRef.current.has(p.provider)) continue;
      startedRef.current.add(p.provider);

      void Actions.Onboarding.startBackfill(p.provider).then(({ ok, body }) => {
        if (!ok) {
          setError(body.error ?? `${p.label} backfill failed to start`);
        }
      });
    }
    // `runningKey` is the dependency: `currentStatus` changes on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningKey]);

  useEffect(() => {
    if (!anyRunning) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      const progress = await Actions.Onboarding.getProgress();

      if (!cancelled && progress) {
        setCurrentStatus(progress);
      }
    };

    void poll();

    const interval = window.setInterval(poll, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [anyRunning]);

  return {
    status: currentStatus,
    error,
    isRunning: (provider: IntegrationProvider | null) => running.some((p) => p.provider === provider),
    refresh,
  };
}
