"use client";

import {
  ArrowRight,
  Bell,
  BellRing,
  CircleAlert,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COMMITMENT_STATUS_STYLES } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

export interface AlertItem {
  commitmentId: string;
  caseId: string;
  externalId: string;
  subject: string | null;
  status: "at_risk" | "breached";
  remainingMinutes: number;
}

type Tab = "all" | "at_risk" | "breached";

function formatSpan(totalMinutes: number): string {
  const abs = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

const tabClass = (active: boolean) =>
  cn(
    "rounded cursor-pointer px-2.5 py-1 font-mono text-xxs font-semibold transition-colors",
    active
      ? "bg-primary text-on-primary"
      : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
  );

/** Header bell: live at-risk / breached commitments, from the same data as the At Risk page. */
export function AlertsPopover({ items }: { items: AlertItem[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const atRisk = items.filter((i) => i.status === "at_risk");
  const breached = items.filter((i) => i.status === "breached");
  const visible = tab === "all" ? items : tab === "at_risk" ? atRisk : breached;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Alerts (${items.length})`}
          className="cursor-pointer text-on-surface-variant hover:bg-surface-container relative flex size-9 items-center justify-center rounded-md transition-colors"
        >
          <Bell className="size-4" />
          {items.length > 0 && (
            <span
              className={cn(
                "absolute inset-e-1.5 top-1.5 size-2 rounded-full",
                COMMITMENT_STATUS_STYLES.breached.fill,
              )}
              aria-hidden
            />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="bg-surface-container-low w-full max-w-sm overflow-hidden rounded-xl border-0 p-0 shadow-xl"
      >
        <div className="bg-surface-container flex items-center gap-2 px-4 py-3">
          <BellRing className="text-primary size-4" />
          <span className="text-on-surface text-sm font-semibold tracking-tight">
            Notifications
          </span>
          {items.length > 0 && (
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 font-mono text-xxs font-bold uppercase">
              {items.length} active
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 px-4 py-2">
          <button
            type="button"
            className={tabClass(tab === "all")}
            onClick={() => setTab("all")}
          >
            All ({items.length})
          </button>
          <button
            type="button"
            className={tabClass(tab === "at_risk")}
            onClick={() => setTab("at_risk")}
          >
            At Risk ({atRisk.length})
          </button>
          <button
            type="button"
            className={tabClass(tab === "breached")}
            onClick={() => setTab("breached")}
          >
            Breaches ({breached.length})
          </button>
        </div>

        <div className="flex max-h-[380px] flex-col gap-1.5 overflow-y-auto px-2 pb-2">
          {visible.length === 0 && (
            <p className="text-on-surface-variant px-2 py-6 text-center text-xs">
              Nothing needs attention right now.
            </p>
          )}
          {visible.slice(0, 20).map((item) => {
            const breach = item.status === "breached";
            return (
              <Link
                key={item.commitmentId}
                href={`/cases/${item.caseId}`}
                className="bg-surface-container hover:bg-surface-container-high flex gap-3 rounded-lg p-3 transition-colors"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded",
                    COMMITMENT_STATUS_STYLES[item.status].chip,
                  )}
                >
                  {breach ? (
                    <CircleAlert className="size-4" />
                  ) : (
                    <TriangleAlert className="size-4" />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-on-surface truncate font-mono text-xs font-semibold">
                    Case #{item.externalId}{" "}
                    {breach ? "SLA Breached" : "Runway Warning"}
                  </span>
                  {item.subject && (
                    <span className="text-on-surface-variant line-clamp-1 text-xs">
                      {item.subject}
                    </span>
                  )}
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-xxs font-semibold uppercase",
                        COMMITMENT_STATUS_STYLES[item.status].chip,
                      )}
                    >
                      {breach
                        ? `Overdue +${formatSpan(item.remainingMinutes)}`
                        : `${formatSpan(item.remainingMinutes)} left`}
                    </span>
                    <span className="text-primary flex items-center gap-0.5 font-mono text-xxs">
                      View case <ArrowRight className="size-3" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="bg-surface-container flex items-center justify-between px-4 py-2.5 font-mono text-xxs">
          <Link
            href="/settings/notifications"
            className="text-on-surface-variant hover:text-on-surface flex items-center gap-1"
          >
            <SlidersHorizontal className="size-3.5" /> Notification Preferences
          </Link>
          <Link
            href="/at-risk"
            className="text-primary flex items-center gap-0.5 hover:underline"
          >
            View all <ArrowRight className="size-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
