"use client";

import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CustomStatus } from "@/lib/custom-provider/status";
import { formatLongDateTime } from "@/lib/format";
import { FailureReasons } from "./FailureReasons";

const OUTCOME_BADGE = { ok: "success", partial: "default", failed: "destructive", aborted: "warning" } as const;

/**
 * When the source was last checked and when its data last actually changed
 * (D32). The two are stored separately and never read from the history below,
 * which no longer holds a row for a sync that found nothing new.
 */
export function SyncFreshness({ status }: { status: CustomStatus }) {
  const timeZone = useOrgTimezone();
  const show = (iso: string | null, empty: string) => (iso ? formatLongDateTime(new Date(iso), timeZone) : empty);
  const checked = status.lastSuccessfulSyncAt ? Date.parse(status.lastSuccessfulSyncAt) : null;
  const changed = status.lastDataChangedAt ? Date.parse(status.lastDataChangedAt) : null;
  const unchangedSince = checked !== null && (changed === null || checked > changed);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        <div className="flex gap-1">
          <dt className="text-on-surface-variant">Last checked:</dt>
          <dd>
            <bdi>{show(status.lastSuccessfulSyncAt, "Not checked yet")}</bdi>
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-on-surface-variant">Last data update:</dt>
          <dd>
            <bdi>{show(status.lastDataChangedAt, "Not recorded yet")}</bdi>
          </dd>
        </div>
      </dl>
      {unchangedSince && (
        <p className="text-on-surface-variant">{changed === null ? "No data changes recorded yet." : "No data changes detected since the last update."}</p>
      )}
    </div>
  );
}

/** Syncs that changed data or did not finish cleanly (30 days of history), and the tickets that could not be processed. Codes and counts only: no payload text. */
export function RunHistory({ status }: { status: CustomStatus }) {
  const timeZone = useOrgTimezone();
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
                <span className="font-mono">{f.recordId}</span>: <FailureReasons code={f.code} details={f.details} />
              </li>
            ))}
          </ul>
          <p className="text-on-surface-variant mt-1">They are retried on every sync.</p>
        </div>
      )}
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead align="end">Tickets read</TableHead>
            <TableHead align="end">Failed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {status.runs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-on-surface-variant text-center">
                No data changes or failures recorded.
              </TableCell>
            </TableRow>
          )}
          {status.runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell nowrap>{formatLongDateTime(new Date(run.startedAt), timeZone)}</TableCell>
              <TableCell>
                <Badge variant={OUTCOME_BADGE[run.outcome]}>{run.outcome}</Badge>
              </TableCell>
              <TableCell className="font-mono">
                {run.reasonCode ?? "—"}
                {run.secondaryReason ? ` (+${run.secondaryReason})` : ""}
              </TableCell>
              <TableCell align="end">{run.recordsFetched}</TableCell>
              <TableCell align="end">{run.failureCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
