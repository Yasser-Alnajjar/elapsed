"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { DashboardSourceStatus } from "@/lib/types/dashboard";

function SourceConnection({
  label,
  connected,
  connectedClass,
}: {
  label: string;
  connected: boolean;
  connectedClass: string;
}) {
  return (
    <span
      className={
        connected
          ? `${connectedClass} font-mono text-xs`
          : "text-outline font-mono text-xs"
      }
    >
      {label} ({connected ? "Connected" : "Not connected"})
    </span>
  );
}

/** Page title, analysis window, source connections, plus the export and refresh actions. */
export function DashboardStatusBar({
  organizationName,
  periodDays,
  autoSyncSeconds,
  sourceStatus,
}: {
  organizationName: string | null;
  periodDays: number;
  autoSyncSeconds: number;
  sourceStatus: DashboardSourceStatus;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return (
    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="text-outline font-mono text-xxs font-semibold uppercase tracking-wider">
            Deterministic Attribution
          </span>
          {organizationName && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-primary font-mono text-xxs uppercase">
                {organizationName}
              </span>
            </>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="text-on-surface text-2xl font-semibold tracking-tight">
            Elapsed Operations Ledger
          </span>
          <span className="bg-surface-container-high text-on-surface-variant rounded px-2 py-0.5 font-mono text-xs">
            Fixed {periodDays}-Day Analysis Window
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-outline">Read-only sync active:</span>
          <SourceConnection
            {...sourceStatus.ticketSource}
            connectedClass="text-tertiary"
          />
          <span className="text-muted-foreground text-xxs">•</span>
          <SourceConnection
            {...sourceStatus.tracker}
            connectedClass="text-primary"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 self-start lg:self-auto flex-wrap">
        <a
          href="/api/reports/commitments"
          download
          className="cursor-pointer bg-surface-container hover:bg-surface-container-high text-on-surface shadow-soft flex items-center gap-2 rounded px-3.5 py-2 text-xs md:text-sm transition-colors"
        >
          <Download className="text-primary size-4" />
          Export Full Report ({periodDays} Days)
        </a>
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          className="cursor-pointer bg-surface-container-high hover:bg-surface-active text-on-surface shadow-soft flex items-center gap-2 rounded px-3.5 py-2 text-xs md:text-sm transition-colors"
        >
          <RefreshCw
            className={`text-tertiary size-4 ${refreshing ? "animate-spin" : ""}`}
          />
          <span className="font-mono text-xs uppercase">
            Auto-Sync: {autoSyncSeconds}s
          </span>
        </button>
      </div>
    </div>
  );
}
