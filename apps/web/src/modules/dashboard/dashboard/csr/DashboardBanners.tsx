"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Network, X } from "lucide-react";
import { Reveal } from "@/components/shared/reveal";
import { formatCommitmentKind, formatMinutes } from "@/lib/format";
import type { DashboardData } from "@/lib/types/dashboard";

/** Shown until a work tracker is linked: engineering figures are blank, not zero. */
export function NoTrackerBanner() {
  return (
    <div className="bg-surface-container-low shadow-soft relative flex flex-col gap-2 overflow-hidden rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
      <div
        className="bg-primary absolute inset-y-0 inset-s-0 w-1.5"
        aria-hidden
      />
      <div className="flex items-start gap-3 ps-2">
        <span className="bg-surface-container-highest flex size-8 shrink-0 items-center justify-center rounded">
          <Network className="text-primary size-4" />
        </span>
        <div>
          <p className="text-on-surface text-sm font-medium">
            Engineering time appears once a tracker is connected
          </p>
          <p className="text-outline text-sm">
            Support-side commitments and breaches are measured already.
            Engineering figures stay blank, not zero, until a work tracker is
            linked.
          </p>
        </div>
      </div>
      <Link
        href="/settings/integrations"
        className="text-primary shrink-0 ps-2 text-sm font-medium hover:underline sm:ps-0"
      >
        Connect a work tracker
      </Link>
    </div>
  );
}

/**
 * Dismissible list of customer/kind pairs whose recent cycle times drifted
 * from baseline. Owns its reveal wrapper so that, once dismissed, nothing is
 * left behind in the page's gap-spaced column.
 */
export function CycleTimeAnomaliesBanner({
  anomalies,
}: {
  anomalies: DashboardData["cycleTimeAnomalies"];
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <Reveal delay={0.03}>
      <div className="bg-surface-container-low shadow-soft relative overflow-hidden rounded-xl p-4">
        <div
          className="bg-warning absolute inset-y-0 inset-s-0 w-1.5"
          aria-hidden
        />
        <div className="flex flex-col gap-3 ps-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="bg-surface-container-highest flex size-8 shrink-0 items-center justify-center rounded">
              <AlertTriangle className="text-warning size-4" />
            </span>
            <div>
              <p className="text-warning font-mono text-xxs font-semibold uppercase tracking-wider">
                Unusual cycle times
              </p>
              <ul className="text-outline mt-1.5 space-y-1 text-sm">
                {anomalies.map((row, i) => (
                  <li key={i}>
                    <span className="text-on-surface font-medium">
                      {row.customerName}
                    </span>{" "}
                    · {formatCommitmentKind(row.kind)} is running{" "}
                    <span className="text-on-surface font-medium">
                      {row.direction}
                    </span>{" "}
                    than usual: recent median{" "}
                    {formatMinutes(row.recentMedianMinutes)} vs. baseline{" "}
                    {formatMinutes(row.baselineMedianMinutes)} (
                    {row.recentCount} recent of {row.baselineCount} historical
                    cases).
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="cursor-pointer text-outline hover:text-on-surface shrink-0 p-1.5 transition-colors"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </Reveal>
  );
}
