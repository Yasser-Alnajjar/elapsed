"use client";

import { History } from "lucide-react";

import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import type { CaseDetailData } from "@/lib/types/cases";

import { EscalationDispatchLog } from "./EscalationDispatchLog";
import { TimelineEventItem } from "./TimelineEvent";

export function ActivityTimeline({ data }: { data: CaseDetailData }) {
  const lastEvent = data.timeline[data.timeline.length - 1];
  const { containerRef, onScroll } = useStickToBottom<HTMLOListElement>(
    lastEvent?.id ?? "",
  );

  return (
    <div>
      <div className="flex flex-col gap-4 rounded-xl bg-surface-container-low shadow-sm">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-2">
            <History className="size-5.5 text-primary" />
            <h2 className="text-xl font-medium tracking-tight text-on-surface">
              State Transitions
            </h2>
          </div>
          <span className="font-mono text-xs leading-4 text-outline">
            {data.timeline.length} Event{data.timeline.length !== 1 ? "s" : ""}{" "}
            Recorded
          </span>
        </div>

        {data.timeline.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No activity yet.</p>
        ) : (
          <ol
            ref={containerRef}
            onScroll={onScroll}
            className="relative max-h-144 overflow-y-auto ps-12 pe-6 pb-6 flex flex-col gap-5"
          >
            {data.timeline.map((event, index) => (
              <TimelineEventItem
                key={event.id}
                event={event}
                isLast={index === data.timeline.length - 1}
              />
            ))}
          </ol>
        )}
      </div>

      <EscalationDispatchLog />
    </div>
  );
}
