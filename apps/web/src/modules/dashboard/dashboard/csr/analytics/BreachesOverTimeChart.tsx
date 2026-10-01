"use client";

import { ShieldCheck } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/shared/empty-state";
import type { BreachesOverTimeLegPoint } from "@/lib/types/dashboard";

function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function BreachesOverTimeChart({
  data,
  periodDays,
}: {
  data: BreachesOverTimeLegPoint[];
  periodDays: number;
}) {
  const hasBreaches = data.some(
    (p) => p.supportCount > 0 || p.engineeringCount > 0,
  );

  return (
    <div className="bg-surface-container-low shadow-soft flex h-full flex-col justify-between rounded-xl p-4">
      <div className="mb-2 flex items-center justify-between flex-wrap">
        <div>
          <h3 className="text-on-surface text-base font-medium">
            Breaches Over Time
          </h3>
          <p className="text-outline text-sm">
            Fixed {periodDays}-day cadence by ticket failure locus
          </p>
        </div>
        <div className="flex items-center gap-3 text-xxs">
          <span className="flex items-center gap-1.5">
            <span className="bg-primary size-2.5 rounded-sm" />
            <span className="text-outline">Support</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-error size-2.5 rounded-sm" />
            <span className="text-outline">Engineering</span>
          </span>
        </div>
      </div>
      {!hasBreaches ? (
        <div className="flex h-48 items-center justify-center">
          <EmptyState
            icon={ShieldCheck}
            title="No breaches in this period"
            description={`Nothing has breached in the last ${periodDays} days.`}
          />
        </div>
      ) : (
        <div className="h-48 w-full min-w-0 overflow-x-clip">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 0, left: -28, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDayLabel}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip
                labelFormatter={(label) => formatDayLabel(String(label))}
                cursor={{ fill: "var(--popover)" }}
                contentStyle={{
                  background: "var(--popover)",
                  borderColor: "var(--border)",
                  borderRadius: 8,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey="supportCount"
                name="Support"
                stackId="leg"
                fill="var(--primary)"
                radius={[2, 2, 2, 2]}
              />
              <Bar
                dataKey="engineeringCount"
                name="Engineering"
                stackId="leg"
                fill="var(--error)"
                radius={[2, 2, 2, 2]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
