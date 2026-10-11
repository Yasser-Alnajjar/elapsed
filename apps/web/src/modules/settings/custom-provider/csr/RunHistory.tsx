"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CustomStatus } from "@/lib/custom-provider/status";
import { formatLongDateTime } from "@/lib/format";
import { FailureReasons } from "./FailureReasons";

const OUTCOME_MARK = {
  ok: "●",
  partial: "▲",
  failed: "✕",
  aborted: "▲",
} as const;
const OUTCOME_BADGE = {
  ok: "success",
  partial: "default",
  failed: "destructive",
  aborted: "warning",
} as const;

/**
 * When the source was last checked and when its data last actually changed
 * (D32). The two are stored separately and never read from the history below,
 * which no longer holds a row for a sync that found nothing new.
 */
export function SyncFreshness({ status }: { status: CustomStatus }) {
  const timeZone = useOrgTimezone();
  const show = (iso: string | null, empty: string) =>
    iso ? formatLongDateTime(new Date(iso), timeZone) : empty;
  const checked = status.lastSuccessfulSyncAt
    ? Date.parse(status.lastSuccessfulSyncAt)
    : null;
  const changed = status.lastDataChangedAt
    ? Date.parse(status.lastDataChangedAt)
    : null;
  const unchangedSince =
    checked !== null && (changed === null || checked > changed);
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
        <p className="text-on-surface-variant">
          {changed === null
            ? "No data changes recorded yet."
            : "No data changes detected since the last update."}
        </p>
      )}
    </div>
  );
}

/** Tickets that could not be processed in the latest completed run. Codes only: no payload text. */
export function FailedTickets({ status }: { status: CustomStatus }) {
  if (status.failedTicketCount === 0) return null;
  const count = status.failedTicketCount;
  return (
    <section
      className="bg-surface-container-low flex flex-col gap-3 rounded-xl p-5 shadow-soft"
      aria-labelledby="cp-failed"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="cp-failed"
          className="text-on-surface flex items-center gap-2 text-base font-semibold"
        >
          <TriangleAlert className="text-error size-5" />
          {count} ticket{count === 1 ? "" : "s"} could not be processed
        </h2>
        <Badge
          variant="destructive"
          className="font-mono text-[10px] uppercase"
        >
          Action required
        </Badge>
      </div>
      <ul className="flex flex-col gap-1.5">
        {status.failedTickets.slice(0, 10).map((f) => (
          <li
            key={`${f.recordId}${f.code}`}
            className="bg-surface-container rounded-lg p-2.5 text-xs"
          >
            <span className="text-primary font-mono font-semibold">
              {f.recordId}
            </span>
            <span className="text-on-surface-variant mx-2">·</span>
            <FailureReasons code={f.code} details={f.details} />
          </li>
        ))}
      </ul>
      <p className="text-on-surface-variant flex items-center gap-1.5 text-xs">
        <RefreshCw className="size-3.5" />
        They are retried on every sync.
      </p>
    </section>
  );
}

/** Syncs that changed data or did not finish cleanly (30 days of history). Codes and counts only: no payload text. */
export function RunHistory({ status }: { status: CustomStatus }) {
  const timeZone = useOrgTimezone();
  return (
    <div className="flex flex-col gap-2">
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
              <TableCell
                colSpan={5}
                className="text-on-surface-variant text-center"
              >
                No data changes or failures recorded.
              </TableCell>
            </TableRow>
          )}
          {status.runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell nowrap className="font-mono">
                {formatLongDateTime(new Date(run.startedAt), timeZone)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={OUTCOME_BADGE[run.outcome]}
                  className="font-mono text-[10px] uppercase"
                >
                  {OUTCOME_MARK[run.outcome]} {run.outcome}
                </Badge>
              </TableCell>
              <TableCell
                className={`font-mono ${run.outcome === "ok" ? "text-on-surface-variant" : ""}`}
              >
                {run.reasonCode ?? "—"}
                {run.secondaryReason ? ` (+${run.secondaryReason})` : ""}
              </TableCell>
              <TableCell align="end" className="font-mono">
                {run.recordsFetched}
              </TableCell>
              <TableCell
                align="end"
                className={`font-mono ${run.failureCount > 0 ? "text-warning-text font-semibold" : "text-on-surface-variant"}`}
              >
                {run.failureCount}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-on-surface-variant font-mono text-[10px]">
        Showing syncs that changed data or did not finish cleanly. Retained for
        30 days.
      </p>
    </div>
  );
}
