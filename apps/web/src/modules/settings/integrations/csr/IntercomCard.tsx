"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { ReauthBanner } from "@/components/shared/reauth-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { IntercomBackfillResult } from "@/lib/types/integrations";

/** `returnTo="onboarding"` makes the OAuth callback land back in the guided flow instead of the settings page. */
export function IntercomConnectButton({ returnTo }: { returnTo?: "onboarding" }) {
  const href = `/api/integrations/intercom/connect${returnTo ? `?returnTo=${returnTo}` : ""}`;
  return (
    <Button type="button" size="sm" onClick={() => (window.location.href = href)}>
      Connect Intercom
    </Button>
  );
}

export function IntercomBackfillButton({ initialReauthRequired = false }: { initialReauthRequired?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IntercomBackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(initialReauthRequired);

  async function handleClick() {
    setRunning(true);
    setError(null);
    setResult(null);

    const { ok, body } = await Actions.Integrations.runIntercomBackfill();
    setRunning(false);

    if (!ok) {
      if (body.reauthRequired) {
        setReauthRequired(true);
      } else {
        setError(body.error ?? "Backfill failed");
      }
      return;
    }

    setResult(body.backfill);
    router.refresh();
  }

  if (reauthRequired) {
    return <ReauthBanner provider="Intercom" reconnectHref="/api/integrations/intercom/connect" />;
  }

  return (
    <div className="space-y-3">
      <Button type="button" size="sm" variant="surface" onClick={handleClick} disabled={running}>
        {running && <Loader2 className="animate-spin" />}
        {running ? "Running backfill…" : "Run backfill"}
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result && (
        <p className="text-sm text-on-surface-variant">
          {result.conversationsFetched} conversations · {result.conversationPartsFetched} events ·{" "}
          {result.companiesFetched} companies.
        </p>
      )}
    </div>
  );
}
