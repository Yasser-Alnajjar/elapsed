"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { caseCommitmentHref } from "@/lib/case-links";
import { COMMITMENT_STATUS_STYLES, legStyle } from "@/lib/status-styles";
import type { AtRiskRowData } from "@/lib/types/at-risk";
import { cn } from "@/lib/utils";
import { CardIdentity } from "./at-risk-card/CardIdentity";
import { RunwayCountdown } from "./at-risk-card/RunwayCountdown";
import { TimeAllocationPanel } from "./at-risk-card/TimeAllocationPanel";

export function AtRiskCard({ row }: { row: AtRiskRowData }) {
  const href = caseCommitmentHref(row.caseId, row.commitmentId);
  const statusStyle = COMMITMENT_STATUS_STYLES[row.status];

  const currentLegTone = legStyle(row.currentLeg).text;
  const currentLegDot = legStyle(row.currentLeg).fill;

  const isCritical = row.status === "breached" || row.status === "at_risk";

  return (
    <article className="flex flex-col gap-4 rounded bg-surface-container-low p-4 font-mono transition-colors hover:bg-surface-container sm:p-5">
      {/* Identification + Countdown */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <CardIdentity row={row} href={href} statusStyle={statusStyle} />

        {/* Countdown Locus Panel */}
        <RunwayCountdown
          row={row}
          statusStyle={statusStyle}
          isCritical={isCritical}
        />
      </div>

      {/* Time Allocation */}
      <TimeAllocationPanel
        row={row}
        statusStyle={statusStyle}
        isCritical={isCritical}
        currentLegTone={currentLegTone}
      />

      {/* Remediation / Actions */}
      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", currentLegDot)}
          />

          <span>
            Assignee: Support (
            <span className="text-foreground">
              {row.supportAssigneeName ?? "Unassigned"}
            </span>
            )
          </span>
        </div>

        <Link
          href={href}
          className="inline-flex items-center justify-center gap-1 rounded bg-primary-container px-3 py-1.5 text-xs font-medium text-on-primary transition-colors hover:bg-primary-fixed-dim"
        >
          <span>Inspect Timeline</span>
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
