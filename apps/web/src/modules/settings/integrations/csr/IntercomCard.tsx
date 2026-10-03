"use client";

import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { BackfillButton } from "./BackfillButton";

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
  return (
    <BackfillButton
      provider="Intercom"
      reconnectHref="/api/integrations/intercom/connect"
      initialReauthRequired={initialReauthRequired}
      run={Actions.Integrations.runIntercomBackfill}
      renderResult={({ backfill }) => (
        <p className="wrap-break-word">
          {backfill.conversationsFetched} conversations · {backfill.conversationPartsFetched} events ·{" "}
          {backfill.companiesFetched} companies.
        </p>
      )}
    />
  );
}
