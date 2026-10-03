import { BillingCard } from "@/components/billing/billing-ui";
import { formatBillingDay, formatInteger } from "@/lib/billing-format";
import type { UsageDay } from "@/lib/types/billing";
import { cn } from "@/lib/utils";

interface IngestionVelocityChartProps {
  /** One entry per day of the billing period (or trial); future days carry the observed average. */
  usage: UsageDay[];
}

/**
 * "Monthly Ingestion Velocity": one bar per day of the billing period, observed
 * days in the brand colour (taller is stronger), projected days muted, today
 * solid. Values are on each bar's tooltip and summarised for screen readers.
 */
export function IngestionVelocityChart({ usage }: IngestionVelocityChartProps) {
  const max = Math.max(1, ...usage.map((day) => day.events));
  const observedDays = usage.filter((day) => !day.projected);
  // Observed days come first, so the last of them is today.
  const todayIndex = observedDays.length - 1;
  const observed = observedDays.reduce((sum, day) => sum + day.events, 0);
  const first = usage[0];
  const today = usage[todayIndex];
  const last = usage[usage.length - 1];

  return (
    <BillingCard aria-labelledby="velocity-title" className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 id="velocity-title" className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
            Monthly Ingestion Velocity
          </h3>
          <p className="text-muted-foreground text-xs">Events ingested from connected sources per day this period</p>
        </div>
        <div className="text-foreground-subtle flex items-center gap-4 font-mono text-[10px]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="bg-primary size-2.5 rounded-sm" />
            Observed ingest
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="bg-outline h-0.5 w-2.5" />
            Projected
          </span>
        </div>
      </div>

      <div className="bg-surface-raised flex flex-col gap-2 rounded p-4">
        <div
          role="img"
          aria-label={`${formatInteger(observed)} events ingested so far this period.`}
          className="flex h-28 w-full items-end gap-[3px] pt-4 sm:gap-1.5"
        >
          {usage.map((day, index) => {
            const ratio = day.events / max;
            const isToday = index === todayIndex;
            return (
              <div
                key={day.date}
                title={`${formatBillingDay(day.date)}${isToday ? " (today)" : ""}: ${day.projected ? "~" : ""}${formatInteger(day.events)} events${day.projected ? " projected" : ""}`}
                className={cn(
                  "min-w-0 flex-1 rounded-t-sm transition-colors",
                  day.projected ? "bg-surface-container-highest" : isToday ? "bg-primary" : "bg-primary hover:opacity-100!",
                )}
                style={{
                  height: `${Math.max(4, Math.round(ratio * 100))}%`,
                  opacity: day.projected || isToday ? undefined : 0.25 + ratio * 0.5,
                }}
              />
            );
          })}
        </div>
        {first && last && (
          <div className="text-foreground-subtle flex items-center justify-between gap-2 pt-2 font-mono text-[10px]">
            <span>Day 1 ({formatBillingDay(first.date)})</span>
            {today && <span className="text-primary font-semibold">Today ({formatBillingDay(today.date)})</span>}
            <span className="text-right">Billing cutoff ({formatBillingDay(new Date(Date.parse(last.date) + 86_400_000).toISOString())})</span>
          </div>
        )}
      </div>
    </BillingCard>
  );
}
