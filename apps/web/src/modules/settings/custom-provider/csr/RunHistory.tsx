"use client";

import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { Badge } from "@/components/ui/badge";
import type { CustomStatus } from "@/lib/custom-provider/status";
import { formatLongDateTime } from "@/lib/format";

const OUTCOME_BADGE = { ok: "success", partial: "default", failed: "destructive", aborted: "warning" } as const;

/** Recent syncs (30 days of history) and the tickets that could not be processed. Codes and counts only: no payload text. */
export function RunHistory({ status }: { status: CustomStatus }) {
  const timeZone = useOrgTimezone();
  if (status.runs.length === 0) return <p className="text-on-surface-variant text-xs">No sync has run yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {status.failedTicketCount > 0 && (
        <div className="bg-surface-container-low rounded-lg p-3 text-xs">
          <p className="font-medium">
            {status.failedTicketCount} ticket{status.failedTicketCount === 1 ? "" : "s"} could not be processed
          </p>
          <ul className="mt-1">
            {status.failedTickets.slice(0, 10).map((f) => (
              <li key={`${f.recordId}${f.code}`}>
                <span className="font-mono">{f.recordId}</span>: {f.code}
              </li>
            ))}
          </ul>
          <p className="text-on-surface-variant mt-1">They are retried on every sync.</p>
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-on-surface-variant text-left">
            <th className="py-1 pe-3 font-medium">Started</th>
            <th className="pe-3 font-medium">Outcome</th>
            <th className="pe-3 font-medium">Reason</th>
            <th className="pe-3 font-medium">Tickets read</th>
            <th className="font-medium">Failed</th>
          </tr>
        </thead>
        <tbody>
          {status.runs.map((run) => (
            <tr key={run.id}>
              <td className="py-1 pe-3">{formatLongDateTime(new Date(run.startedAt), timeZone)}</td>
              <td className="pe-3">
                <Badge variant={OUTCOME_BADGE[run.outcome]}>{run.outcome}</Badge>
              </td>
              <td className="pe-3 font-mono">{run.reasonCode ?? ""}{run.secondaryReason ? ` (+${run.secondaryReason})` : ""}</td>
              <td className="pe-3">{run.recordsFetched}</td>
              <td>{run.failureCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
