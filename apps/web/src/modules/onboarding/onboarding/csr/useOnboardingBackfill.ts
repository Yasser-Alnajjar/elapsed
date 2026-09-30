"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Actions } from "@/actions/client";
import type { OnboardingStatus, ProviderOnboardingStatus } from "@/lib/types/onboarding";

interface UseOnboardingBackfillOptions {
  status: OnboardingStatus;
}

const PROVIDERS = ["zendesk", "intercom", "jira", "linear"] as const;
type BackfillProvider = (typeof PROVIDERS)[number];

const START_BACKFILL: Record<BackfillProvider, () => Promise<{ ok: boolean; body: { error?: string } }>> = {
  zendesk: () => Actions.Onboarding.startZendeskBackfill(),
  intercom: () => Actions.Onboarding.startIntercomBackfill(),
  jira: () => Actions.Onboarding.startJiraBackfill(),
  linear: () => Actions.Onboarding.startLinearBackfill(),
};

const PROVIDER_LABEL: Record<BackfillProvider, string> = {
  zendesk: "Zendesk",
  intercom: "Intercom",
  jira: "Jira",
  linear: "Linear",
};

const isRunning = (p: ProviderOnboardingStatus) => p.connected && !p.backfillComplete && !p.reauthRequired;

export function useOnboardingBackfill({
  status,
}: UseOnboardingBackfillOptions) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [error, setError] = useState<string | null>(null);

  const startedRef = useRef<Record<BackfillProvider, boolean>>({
    zendesk: false,
    intercom: false,
    jira: false,
    linear: false,
  });

  const zendeskRunning = isRunning(currentStatus.zendesk);
  const intercomRunning = isRunning(currentStatus.intercom);
  const jiraRunning = isRunning(currentStatus.jira);
  const linearRunning = isRunning(currentStatus.linear);
  const anyRunning = zendeskRunning || intercomRunning || jiraRunning || linearRunning;

  const refresh = useCallback(async () => {
    const progress = await Actions.Onboarding.getProgress();

    if (progress) {
      setCurrentStatus(progress);
    }

    return progress;
  }, []);

  useEffect(() => {
    const running: Record<BackfillProvider, boolean> = {
      zendesk: zendeskRunning,
      intercom: intercomRunning,
      jira: jiraRunning,
      linear: linearRunning,
    };

    for (const provider of PROVIDERS) {
      if (!running[provider] || startedRef.current[provider]) continue;
      startedRef.current[provider] = true;

      void START_BACKFILL[provider]().then(({ ok, body }) => {
        if (!ok) {
          setError(body.error ?? `${PROVIDER_LABEL[provider]} backfill failed to start`);
        }
      });
    }
  }, [zendeskRunning, intercomRunning, jiraRunning, linearRunning]);

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
    zendeskRunning,
    intercomRunning,
    jiraRunning,
    linearRunning,
    refresh,
  };
}
