"use client";

import {
  AlertTriangle,
  Clock,
  Network,
  CirclePause,
} from "lucide-react";

import { Reveal } from "@/components/shared/reveal";
import { formatMinutes } from "@/lib/format";
import type { AtRiskPageData, AtRiskThreatSample } from "@/lib/types/at-risk";

import { AtRiskKpiTile } from "./AtRiskKpiTile";

type AtRiskKpiGridProps = {
  data: AtRiskPageData;
};

function sampleDetail(
  sample: AtRiskThreatSample[],
  emptyLabel: string,
): string {
  return sample.length > 0
    ? sample
        .map((row) => `${row.customerName ?? "Unknown"} #${row.externalId}`)
        .join(", ")
    : emptyLabel;
}

export const AtRiskKpiGrid = ({ data }: AtRiskKpiGridProps) => {
  // Locus/transit metrics need each candidate's live-derived leg — with no
  // persisted equivalent, they can only be read off this page's already-
  // evaluated rows, not the org-wide candidate set (performance-plan.md
  // Phase 2 item 4: never evaluate the whole open set for a KPI tile).
  const pageRows = data.rows;

  const engineeringCount = pageRows.filter(
    (row) => row.currentLeg === "engineering",
  ).length;

  const avgMinutesInLeg =
    pageRows.length > 0
      ? pageRows.reduce((sum, row) => sum + row.minutesInCurrentLeg, 0) /
        pageRows.length
      : null;

  const locusDetail =
    pageRows.length > 0
      ? `${engineeringCount} of ${pageRows.length} In View`
      : "No open commitments";

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Reveal delay={0.02}>
        <AtRiskKpiTile
          icon={AlertTriangle}
          label="Immediate Threat (< 1h Runway)"
          value={`${data.immediateThreatCount} Cases`}
          qualifier="Critical"
          tone={data.immediateThreatCount > 0 ? "danger" : "neutral"}
          detail={sampleDetail(
            data.immediateThreatSample,
            "No cases below the critical runway threshold",
          )}
        />
      </Reveal>

      <Reveal delay={0.05}>
        <AtRiskKpiTile
          icon={Clock}
          label="Elevated Risk (1h – 2.5h)"
          value={`${data.elevatedRiskCount} Cases`}
          qualifier="Approaching"
          tone={data.elevatedRiskCount > 0 ? "warning" : "neutral"}
          detail={sampleDetail(
            data.elevatedRiskSample,
            "No cases currently approaching the threshold",
          )}
        />
      </Reveal>

      <Reveal delay={0.08}>
        <AtRiskKpiTile
          icon={Network}
          label="Active Clock Locus"
          value={
            pageRows.length > 0
              ? `${Math.round((engineeringCount / pageRows.length) * 100)}% Eng Leg`
              : "—"
          }
          qualifier={locusDetail}
          tone="neutral"
          detail="Clock burning inside Jira queues without resolution"
        />
      </Reveal>

      <Reveal delay={0.1}>
        <AtRiskKpiTile
          icon={CirclePause}
          label="Avg Transit Latency"
          value={
            avgMinutesInLeg !== null ? formatMinutes(avgMinutesInLeg) : "—"
          }
          qualifier="In View"
          tone="success"
          detail="Unassigned in Eng triage backlogs"
        />
      </Reveal>
    </div>
  );
};
