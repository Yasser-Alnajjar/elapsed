"use client";

import type { CaseDetailData } from "@/lib/types/cases";
import { JourneySegmentBar } from "./journey/JourneySegmentBar";
import { AttributionFinding, LegMetricsGrid } from "./journey/LegAttribution";
import { SlaClockBar } from "./journey/SlaClockBar";
import { useCaseJourney } from "./journey/useCaseJourney";

export function CaseJourney({ data }: { data: CaseDetailData }) {
  const journey = useCaseJourney(data);

  if (journey.legSegments.length === 0) {
    return (
      <div className="rounded-xl bg-surface-container-low p-6 shadow-sm">
        <p className="text-sm text-on-surface-variant">No journey data yet.</p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-xl bg-surface-container-low p-6 shadow-sm">
      {/* Title row + legend */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-primary">
            Deterministic Time Split
          </span>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-on-surface">
            Segmented Case Journey &amp; Queue Attribution
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-outline">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded bg-leg-support" />
            Support Leg
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded bg-leg-engineering" />
            Engineering Leg
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded bg-leg-waiting" />
            Pending For Customer Leg
          </span>
        </div>
      </div>

      <JourneySegmentBar data={data} journey={journey} />

      <LegMetricsGrid currentLeg={data.currentLeg} journey={journey} />

      <AttributionFinding journey={journey} />

      <SlaClockBar data={data} journey={journey} />
    </div>
  );
}
