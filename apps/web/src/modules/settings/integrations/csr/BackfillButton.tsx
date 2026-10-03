"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ReauthBanner } from "@/components/shared/reauth-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface BackfillButtonProps<T> {
  /** Display name for the reconnect banner, e.g. "Jira". */
  provider: string;
  /** Where "Reconnect" sends the user — the provider's own /connect route. */
  reconnectHref: string;
  /** True when the stored credentials already carry `reauthRequired` (checked on the server before this renders). */
  initialReauthRequired?: boolean;
  run: () => Promise<{ ok: boolean; body: T & { error?: string; reauthRequired?: boolean } }>;
  /** What the finished run fetched, one line per paragraph. */
  renderResult: (result: T) => ReactNode;
}

/** Runs a provider's 90-day backfill, swapping to the reconnect banner when its credentials have expired. */
export function BackfillButton<T>({
  provider,
  reconnectHref,
  initialReauthRequired = false,
  run,
  renderResult,
}: BackfillButtonProps<T>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(initialReauthRequired);

  async function handleClick() {
    setRunning(true);
    setError(null);
    setResult(null);

    const { ok, body } = await run();
    setRunning(false);

    if (!ok) {
      if (body.reauthRequired) {
        setReauthRequired(true);
      } else {
        setError(body.error ?? "Backfill failed");
      }
      return;
    }

    setResult(body);
    router.refresh();
  }

  if (reauthRequired) {
    return <ReauthBanner provider={provider} reconnectHref={reconnectHref} />;
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-3">
      <Button type="button" size="sm" variant="surface" onClick={handleClick} disabled={running}>
        {running && <Loader2 className="animate-spin" />}
        {running ? "Running backfill…" : "Run backfill"}
      </Button>

      {error && (
        <Alert variant="destructive" className="w-full max-w-full">
          <AlertCircle />
          <AlertDescription className="min-w-0 wrap-break-word">{error}</AlertDescription>
        </Alert>
      )}

      {result !== null && (
        <div className="w-full min-w-0 space-y-1 text-sm text-on-surface-variant">{renderResult(result)}</div>
      )}
    </div>
  );
}
