"use client";

import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { BackfillButton } from "./BackfillButton";

export function JiraConnectButton() {
  return (
    <Button type="button" size="sm" onClick={() => (window.location.href = "/api/integrations/jira/connect")}>
      Connect Jira
    </Button>
  );
}

export function JiraBackfillButton({ initialReauthRequired = false }: { initialReauthRequired?: boolean }) {
  return (
    <BackfillButton
      provider="Jira"
      reconnectHref="/api/integrations/jira/connect"
      initialReauthRequired={initialReauthRequired}
      run={Actions.Integrations.runJiraBackfill}
      renderResult={({ backfill }) => (
        <p className="wrap-break-word">
          {backfill.issuesFetched} issues · {backfill.changelogHistoriesFetched} changelog events ·{" "}
          {backfill.remoteLinksFetched} remote links.
        </p>
      )}
    />
  );
}
