"use client";

import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { BackfillButton } from "./BackfillButton";

export function LinearConnectButton() {
  return (
    <Button type="button" size="sm" onClick={() => (window.location.href = "/api/integrations/linear/connect")}>
      Connect Linear
    </Button>
  );
}

export function LinearBackfillButton({ initialReauthRequired = false }: { initialReauthRequired?: boolean }) {
  return (
    <BackfillButton
      provider="Linear"
      reconnectHref="/api/integrations/linear/connect"
      initialReauthRequired={initialReauthRequired}
      run={Actions.Integrations.runLinearBackfill}
      renderResult={({ backfill }) => (
        <p className="wrap-break-word">
          {backfill.issuesFetched} issues · {backfill.historyEntriesFetched} history events ·{" "}
          {backfill.attachmentsFetched} linked resources.
        </p>
      )}
    />
  );
}
