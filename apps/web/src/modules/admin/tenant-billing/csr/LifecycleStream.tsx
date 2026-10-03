"use client";

import { History, ListFilter } from "lucide-react";
import { useState } from "react";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatLedgerTimestamp } from "@/lib/billing-format";
import type { BillingTone } from "@/lib/types/billing";
import type { LifecycleEvent } from "@/lib/types/admin-billing";
import { cn } from "@/lib/utils";

type EventFilter = "all" | LifecycleEvent["group"];

const FILTER_LABELS: Record<EventFilter, string> = {
  all: "All events",
  payments: "Payments",
  plan: "Plan changes",
  seats: "Seats",
  notes: "Notes & overrides",
};

const TONE_STYLE: Record<BillingTone, { dot: string; tag: string }> = {
  danger: { dot: "bg-error", tag: "bg-error/15 text-error" },
  warning: { dot: "bg-warning", tag: "bg-warning/15 text-warning-text" },
  success: { dot: "bg-success", tag: "bg-success/15 text-success" },
  primary: { dot: "bg-primary", tag: "bg-primary/15 text-primary" },
  neutral: { dot: "bg-foreground-subtle", tag: "bg-surface-container text-muted-foreground" },
};

/** "Chronological Lifecycle Stream": the organization's billing history, newest first, filterable by kind. */
export function LifecycleStream({ events }: { events: LifecycleEvent[] }) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const visible = filter === "all" ? events : events.filter((event) => event.group === filter);

  return (
    <AdminPanel aria-labelledby="lifecycle-title" className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 id="lifecycle-title" className="text-foreground flex items-center gap-2 text-lg font-bold">
            <History aria-hidden className="text-primary size-4.5" />
            Chronological Lifecycle Stream
          </h2>
          <MonoLabel>Billing events &amp; operator overrides</MonoLabel>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="bg-surface-raised hover:bg-surface-hover text-muted-foreground flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] uppercase">
              Filter: {FILTER_LABELS[filter]}
              <ListFilter aria-hidden className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={filter} onValueChange={(value) => setFilter(value as EventFilter)}>
              {(Object.keys(FILTER_LABELS) as EventFilter[]).map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {FILTER_LABELS[key]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground bg-surface-raised rounded p-4 text-sm">
          {events.length === 0 ? "No billing activity yet. Events appear once a plan is chosen." : `No ${FILTER_LABELS[filter].toLowerCase()} recorded.`}
        </p>
      ) : (
        <ol className="before:bg-surface-raised relative flex flex-col gap-4 pl-6 before:absolute before:top-2 before:bottom-2 before:left-2 before:w-0.5">
          {visible.map((event) => {
            const style = TONE_STYLE[event.tone];
            return (
              <li key={event.id} className="group relative">
                <span aria-hidden className={cn("ring-card absolute top-1.5 -left-6 flex size-3.5 items-center justify-center rounded-full ring-4", style.dot)}>
                  <span className="bg-background size-1.5 rounded-full" />
                </span>
                <div className="bg-surface-raised/70 group-hover:bg-surface-raised rounded-lg p-3 transition-colors">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase", style.tag)}>{event.kind}</span>
                      <span className="text-foreground font-mono text-xs font-semibold">{event.title}</span>
                    </div>
                    <time dateTime={event.at} className="text-foreground-subtle font-mono text-[10px]">
                      {formatLedgerTimestamp(event.at)}
                    </time>
                  </div>
                  {event.body && <p className="text-on-surface text-xs leading-5">{event.body}</p>}
                  <p className="text-foreground-subtle mt-1 font-mono text-[10px]">by {event.actor}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="text-foreground-subtle mt-auto flex items-center justify-between pt-4 font-mono text-[10px]">
        <span>
          Showing {visible.length} of {events.length} ledger events
        </span>
      </div>
    </AdminPanel>
  );
}
