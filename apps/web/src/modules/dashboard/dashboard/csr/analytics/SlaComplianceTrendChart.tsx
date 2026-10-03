"use client";

import { Gauge } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/shared/empty-state";
import type { ComplianceTrendPoint } from "@/lib/types/dashboard";
import { CHART_TOOLTIP_STYLE } from "./chart-tooltip";

const BENCHMARK = 95;
const GUIDE_LINE = 90;

export function SlaComplianceTrendChart({
  data,
  currentCompliance,
}: {
  data: ComplianceTrendPoint[];
  currentCompliance: number | null;
}) {
  // A null day had no closed commitments to measure, so it takes no space on the chart.
  const chartData = data
    .filter(
      (point): point is ComplianceTrendPoint & { compliancePercent: number } =>
        point.compliancePercent !== null,
    )
    .map((point, index) => ({ ...point, index }));

  if (chartData.length === 0) {
    return (
      <div className="bg-surface-container-low shadow-soft flex h-full min-h-0 flex-col overflow-hidden rounded-xl p-4">
        <div className="shrink-0">
          <h3 className="text-on-surface text-base font-medium">
            SLA Compliance Trend
          </h3>

          <p className="text-outline text-sm">Trailing 7-day compliance rate</p>
        </div>

        <div className="flex min-h-48 flex-1 items-center justify-center">
          <EmptyState
            icon={Gauge}
            title="No trend yet"
            description="Appears once commitments start closing in this period."
          />
        </div>
      </div>
    );
  }

  const values = chartData.map((point) => point.compliancePercent);
  const peak = Math.max(...values);
  const low = Math.min(...values);
  const maxIndex = Math.max(chartData.length - 1, 1);

  return (
    <div className="bg-surface-container-low shadow-soft flex h-full min-h-0 flex-col overflow-hidden rounded-xl p-4">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-on-surface text-base font-medium">
            SLA Compliance Trend
          </h3>

          <p className="text-outline text-sm">Trailing 7-day compliance rate</p>
        </div>

        <span className="bg-surface-container-highest text-on-surface-variant shrink-0 rounded px-2 py-0.5 font-mono text-xxs">
          No target configured
        </span>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-x-clip">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{
              top: 24,
              right: 0,
              left: 0,
              bottom: 0,
            }}
          >
            <defs>
              <linearGradient
                id="complianceGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="var(--telemetry)" stopOpacity={0.25} />

                <stop offset="100%" stopColor="var(--telemetry)" stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis type="number" dataKey="index" domain={[0, maxIndex]} hide />

            <YAxis type="number" domain={[0, 100]} hide />

            {/* 90% reference */}
            <CartesianGrid
              horizontalCoordinatesGenerator={({ height }) => [
                height * (1 - GUIDE_LINE / 100),
              ]}
              vertical={false}
              stroke="currentColor"
              className="text-surface-container-highest"
              strokeWidth={1}
            />

            {/* 95% benchmark */}
            <CartesianGrid
              horizontalCoordinatesGenerator={({ height }) => [
                height * (1 - BENCHMARK / 100),
              ]}
              vertical={false}
              stroke="var(--telemetry)"
              strokeDasharray="3 3"
              strokeWidth={1.5}
              opacity={0.6}
            />

            <Tooltip
              cursor={false}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
              formatter={(value) => [
                value === null ? "—" : `${value}%`,
                "Compliance",
              ]}
              contentStyle={CHART_TOOLTIP_STYLE}
            />

            <Area
              type="monotone"
              dataKey="compliancePercent"
              stroke="var(--warning)"
              strokeWidth={2.5}
              fill="url(#complianceGradient)"
              fillOpacity={1}
              connectNulls={false}
              dot={false}
              activeDot={{
                r: 4,
                fill: "var(--warning)",
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="text-outline border-surface-container-highest/60 mt-2 flex shrink-0 items-center justify-between border-t pt-2 font-mono text-xxs">
        <span>{peak}% peak</span>

        <span className="font-medium text-warning">
          Current: {currentCompliance !== null ? `${currentCompliance}%` : "—"}
        </span>

        <span>{low}% low</span>
      </div>
    </div>
  );
}
