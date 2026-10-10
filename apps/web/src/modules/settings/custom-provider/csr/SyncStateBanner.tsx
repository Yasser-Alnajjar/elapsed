"use client";

import { Alert } from "@/components/ui/alert";
import { ATTENTION_COPY, STATE_COPY } from "@/lib/custom-provider/state-copy";
import type { CustomStatus } from "@/lib/custom-provider/status";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { formatLongDateTime } from "@/lib/format";

/**
 * Exactly one of the six states (plan 09, 6.13), derived on the server from the
 * latest sync runs. A long import is never shown as a failure and a failure is
 * never shown as an import; staleness is an overlay on any state.
 */
export function SyncStateBanner({ status }: { status: CustomStatus }) {
  const timeZone = useOrgTimezone();
  if (!status.connected || !status.state) return null;
  const copy = STATE_COPY[status.state];
  const latest = status.runs[0];
  const progress = latest?.progress as { listingTickets?: number } | null;
  const variant = copy.tone === "error" ? "destructive" : copy.tone === "success" ? "success" : "default";
  return (
    <div className="flex flex-col gap-2">
      <Alert variant={variant}>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{copy.title}</p>
          <p>{status.state === "needs_attention" && status.attention ? ATTENTION_COPY[status.attention] : copy.body}</p>
          {status.state === "importing_history" && typeof progress?.listingTickets === "number" && <p className="text-xs">{progress.listingTickets} tickets read so far.</p>}
          {status.state === "catching_up" && status.lastSuccessfulSyncAt && <p className="text-xs">Current through {formatLongDateTime(new Date(status.lastSuccessfulSyncAt), timeZone)}.</p>}
        </div>
      </Alert>
      {status.stale && (
        <Alert variant="warning">
          Data may be out of date{status.staleSince ? ` since ${formatLongDateTime(new Date(status.staleSince), timeZone)}` : ""}. Breach alerts for this source are held until a sync completes.
        </Alert>
      )}
    </div>
  );
}
