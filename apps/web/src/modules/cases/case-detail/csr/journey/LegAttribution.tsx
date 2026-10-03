import { CircleAlert } from "lucide-react";
import { formatLeg } from "@/lib/format";
import type { CaseDetailData } from "@/lib/types/cases";
import { LEG_STYLES } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { formatLiveDuration } from "./journey-geometry";
import type { CaseJourneyState } from "./useCaseJourney";

/* 4-metric grid emphasis: the engineering leg is the one called out, in its
   leg colour; the others stay neutral. */
const LEG_METRIC_CLASS: Record<string, string> = {
  support: "text-on-surface",
  engineering: LEG_STYLES.engineering.text,
  waiting_customer: "text-on-surface-variant",
  unknown: "text-on-surface-variant",
};

/** Fixed order — 4-metric grid always shows all 4 cells. */
const LEG_ORDER = [
  "support",
  "engineering",
  "waiting_customer",
  "unknown",
] as const;

const LEG_HEADER_CLASS: Record<string, string> = {
  support: "text-outline",
  engineering: LEG_STYLES.engineering.text,
  waiting_customer: "text-outline",
  unknown: "text-outline",
};

const LEG_DESCRIPTIONS: Record<(typeof LEG_ORDER)[number], string> = {
  support: "Triage, reproduction, and Jira sync dispatch.",
  engineering: "Currently in engineering queue backlog.",
  waiting_customer: "No pending customer queries or blockers.",
  unknown: "Zero unmapped interval gaps across sync.",
};

/** Live time and share of net elapsed for each of the four legs. */
export function LegMetricsGrid({
  currentLeg,
  journey,
}: {
  currentLeg: CaseDetailData["currentLeg"];
  journey: CaseJourneyState;
}) {
  const { isOpen, minutesByLeg, totalLegMinutes } = journey;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {LEG_ORDER.map((leg) => {
        const minutes = minutesByLeg.get(leg) ?? 0;
        const pct = totalLegMinutes > 0 ? (minutes / totalLegMinutes) * 100 : 0;
        const isCurr = isOpen && leg === currentLeg;

        return (
          <div
            key={leg}
            className="flex flex-col rounded-lg bg-surface-container p-3"
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "font-mono text-xxs font-semibold uppercase tracking-wider",
                  LEG_HEADER_CLASS[leg],
                )}
              >
                {formatLeg(leg)}
              </span>
              {isCurr && (
                <span className="size-2 animate-pulse rounded-full bg-error" />
              )}
            </div>
            <span
              className={cn(
                "mt-1 font-mono text-lg font-semibold tabular-nums",
                LEG_METRIC_CLASS[leg],
              )}
            >
              {formatLiveDuration(minutes * 60)}
            </span>
            <span
              className={cn("font-mono text-xxs mt-1", LEG_STYLES[leg].text)}
            >
              {pct.toFixed(1)}% of Net Elapsed
            </span>
            <span className="mt-1 text-xxs text-outline">
              {LEG_DESCRIPTIONS[leg]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Which leg the elapsed SLA window mostly accrued under. Renders nothing until one leg has time. */
export function AttributionFinding({ journey }: { journey: CaseJourneyState }) {
  const { dominantLeg, totalLegMinutes, liveSlaSeconds } = journey;
  if (!dominantLeg || dominantLeg.minutes <= 0) return null;

  return (
    <div className="flex items-start md:items-center gap-3 rounded-lg bg-surface-container-high p-3 text-sm text-on-surface">
      <CircleAlert
        size="14"
        className="mt-1 md:mt-0 text-primary text-base shrink-0"
      />
      <p>
        <strong className="font-medium text-primary">
          Attribution Finding:{" "}
        </strong>
        {((dominantLeg.minutes / totalLegMinutes) * 100).toFixed(1)}% of this
        case&apos;s total elapsed SLA window has accrued while under{" "}
        <strong className="text-on-surface">
          {formatLeg(dominantLeg.leg)}
        </strong>{" "}
        care. SLA clock has been running for{" "}
        <strong className="text-on-surface">
          {formatLiveDuration(liveSlaSeconds)}
        </strong>{" "}
        net.
      </p>
    </div>
  );
}
