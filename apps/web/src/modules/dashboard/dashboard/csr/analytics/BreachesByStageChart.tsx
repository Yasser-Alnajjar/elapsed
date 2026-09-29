"use client";

import { Layers } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { EmptyState } from "@/components/shared/empty-state";
import { formatLeg } from "@/lib/format";
import type { BreachesByStageRow } from "@/lib/types/dashboard";

const LEG_COLORS: Record<string, string> = {
  support: "var(--leg-support)",
  engineering: "var(--leg-engineering)",
  waiting_customer: "var(--leg-waiting)",
  unknown: "var(--leg-unknown)",
};

/** Legible-on-surface variants of the leg colors, for text. */
const LEG_TEXT_COLORS: Record<string, string> = {
  support: "var(--stage-support-text)",
  engineering: "var(--stage-eng-text)",
  waiting_customer: "var(--stage-waiting-text)",
  unknown: "var(--stage-limbo-text)",
};

/**
 * Stitch's "Breaches by Stage" chart is a donut, not the bar chart the
 * pre-reconstruction dashboard used — rebuilt on the same `Pie`/donut
 * pattern the app already uses elsewhere (compliance breakdown), reusing
 * `ProjectAnalyticsData.breachesByStage` unchanged (that data was already
 * correct — only the chart type was wrong).
 */
export function BreachesByStageChart({ data }: { data: BreachesByStageRow[] }) {
  const total = data.reduce((sum, r) => sum + r.count, 0);
  const dominant = data[0];

  return (
    <div className="bg-surface-container-low shadow-soft flex h-full flex-col justify-between rounded-xl p-4">
      <div>
        <h3 className="text-on-surface text-base font-medium">
          Breaches by Stage
        </h3>
        <p className="text-outline text-sm">
          Origin locus across {total} breaches
        </p>
      </div>
      {total === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <EmptyState
            icon={Layers}
            title="No breaches to attribute"
            description="This fills in once a commitment breaches."
          />
        </div>
      ) : (
        <>
          <div className="relative my-2 flex flex-col items-center justify-center">
            <div className="size-36 overflow-x-clip">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="count"
                    nameKey="leg"
                    innerRadius="68%"
                    outerRadius="100%"
                    paddingAngle={data.length > 1 ? 3 : 0}
                    stroke="none"
                  >
                    {data.map((row) => (
                      <Cell
                        key={row.leg}
                        fill={LEG_COLORS[row.leg] ?? "var(--primary)"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    wrapperStyle={{ zIndex: 50 }}
                    formatter={(value, _name, entry) => [
                      `${value} (${Math.round((Number(value) / total) * 100)}%)`,
                      formatLeg(String(entry.payload?.leg ?? "")),
                    ]}
                    contentStyle={{
                      background: "var(--popover)",
                      borderColor: "var(--border)",
                      borderRadius: 8,
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {dominant && (
              <div className="pointer-events-none absolute flex flex-col items-center">
                <span className="text-on-surface text-2xl font-semibold leading-none">
                  {Math.round((dominant.count / total) * 100)}%
                </span>
                <span
                  className="mt-0.5 font-mono text-xxs font-medium uppercase"
                  style={{
                    color: LEG_TEXT_COLORS[dominant.leg] ?? "var(--primary)",
                  }}
                >
                  {formatLeg(dominant.leg)}
                </span>
              </div>
            )}
          </div>
          <div className="border-surface-container-highest/60 flex flex-col gap-1.5 border-t pt-2 text-sm">
            {data.map((row) => (
              <div key={row.leg} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: LEG_COLORS[row.leg] ?? "var(--primary)",
                    }}
                  />
                  <span className="text-on-surface-variant">
                    {formatLeg(row.leg)}
                  </span>
                </div>
                <span className="text-on-surface font-mono text-sm font-semibold">
                  {row.count} ({Math.round((row.count / total) * 100)}%)
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
