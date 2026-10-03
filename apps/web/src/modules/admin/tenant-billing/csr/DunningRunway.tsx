import { CalendarX2, Link2, Timer } from "lucide-react";
import { AdminPanel, ZeroState } from "@/components/admin/admin-ui";
import { formatDaysHours, formatHoursMinutes, formatLedgerTimestamp } from "@/lib/billing-format";
import type { OverdueState } from "@/lib/types/admin-billing";

/**
 * "Stage Handoff & Dunning Runway": time since the oldest open invoice fell
 * due, as legs on one bar: overdue (elapsed), the grace window still left,
 * and the review horizon after it. Informational: nothing is ever locked.
 */
export function DunningRunway({ overdue, asOf }: { overdue: OverdueState | null; asOf: string }) {
  return (
    <AdminPanel aria-labelledby="runway-title" className="flex flex-col gap-4 p-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h2 id="runway-title" className="text-foreground flex items-center gap-2 text-lg font-bold">
            <Timer aria-hidden className="text-primary size-4.5" />
            Stage Handoff &amp; Dunning Runway
          </h2>
          <p className="text-foreground-subtle text-xs">Segments are the time elapsed since the oldest open invoice fell due.</p>
        </div>
        {overdue && <Legend overdue={overdue} asOf={asOf} />}
      </div>
      {overdue ? <Runway overdue={overdue} asOf={asOf} /> : <ZeroState title="No active dunning">No invoice is overdue; there is no runway to watch.</ZeroState>}
    </AdminPanel>
  );
}

function legs(overdue: OverdueState, asOf: string) {
  const start = Date.parse(overdue.dueAt);
  const grace = Date.parse(overdue.graceEndsAt);
  const horizon = grace + (grace - start) / 3;
  const now = Math.min(Date.parse(asOf), horizon);
  const total = Math.max(1, horizon - start);
  const elapsed = Math.max(0, now - start);
  const graceLeft = Math.max(0, grace - now);
  return {
    elapsed,
    graceLeft,
    horizon: new Date(horizon).toISOString(),
    elapsedPct: (elapsed / total) * 100,
    gracePct: (graceLeft / total) * 100,
    restPct: Math.max(0, 100 - ((elapsed + graceLeft) / total) * 100),
  };
}

function Legend({ overdue, asOf }: { overdue: OverdueState; asOf: string }) {
  const { elapsed, graceLeft } = legs(overdue, asOf);
  return (
    <div className="text-foreground-subtle flex flex-wrap items-center gap-4 font-mono text-[11px]">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="bg-error size-3 rounded-sm" />
        Overdue stage ({formatDaysHours(elapsed)})
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="bg-warning size-3 rounded-sm" />
        Active grace window ({formatDaysHours(graceLeft)})
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="bg-surface-container-highest size-3 rounded-sm" />
        Review horizon
      </span>
    </div>
  );
}

function Runway({ overdue, asOf }: { overdue: OverdueState; asOf: string }) {
  const { elapsed, graceLeft, horizon, elapsedPct, gracePct, restPct } = legs(overdue, asOf);
  return (
    <>
      <div className="bg-surface-container rounded-lg p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
          <span className="text-error flex items-center gap-1 font-bold">
            <CalendarX2 aria-hidden className="size-3.5" />
            DUE: {formatLedgerTimestamp(overdue.dueAt)}
          </span>
          <span className="text-warning-text font-bold">GRACE REMAINING: {formatHoursMinutes(graceLeft)}</span>
          <span className="text-foreground-subtle">REVIEW: {formatLedgerTimestamp(horizon)}</span>
        </div>
        <div
          role="img"
          aria-label={`Overdue for ${formatDaysHours(elapsed)}; ${formatHoursMinutes(graceLeft)} of grace left.`}
          className="bg-surface-raised flex h-3 w-full overflow-hidden rounded"
        >
          <div className="bg-error h-full" style={{ width: `${elapsedPct}%` }} title={`Overdue: ${formatDaysHours(elapsed)}`} />
          <div className="bg-warning h-full" style={{ width: `${gracePct}%` }} title={`Grace left: ${formatDaysHours(graceLeft)}`} />
          <div className="bg-surface-container-highest h-full" style={{ width: `${restPct}%` }} title="Review horizon" />
        </div>
      </div>
      <div className="text-foreground-subtle flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
        <span className="flex items-center gap-1">
          <Link2 aria-hidden className="text-primary size-3.5" />
          Source: internal billing ledger, invoice {overdue.invoiceNumber}
        </span>
        <span>Policy: net 14 · 7-day grace</span>
      </div>
    </>
  );
}
