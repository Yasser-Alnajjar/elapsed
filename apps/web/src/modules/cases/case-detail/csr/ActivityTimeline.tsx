"use client";

import type { ReactNode } from "react";
import { Bell, History } from "lucide-react";

import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import {
  formatActor,
  formatCommitmentKind,
  formatDateTime,
  formatMinutes,
  formatNormalizedState,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import type { CaseDetailData, TimelineEventDetail } from "@/lib/types/cases";
import { Button } from "@/components/ui/button";

/* ─── Per-event pill labels (Stitch "State Transitions") ─────── */

const EVENT_TYPE_PILL_LABEL: Record<string, string> = {
  case_created: "CLOCK START",
  state_changed: "STATE CHANGE",
  issue_linked: "HANDOFF",
  issue_unlinked: "UNLINKED",
  case_closed: "CASE CLOSED",
  agent_replied: "AGENT REPLY",
  customer_replied: "CUSTOMER REPLY",
  priority_changed: "PRIORITY CHANGE",
  policy_changed: "POLICY RE-MATCH",
  commitment_started: "CLOCK START",
  commitment_at_risk: "TRIGGERED",
  commitment_breached: "BREACHED",
  commitment_met: "SLA MET",
  commitment_cancelled: "CANCELLED",
};

/* ─── Per-event dot ring + pill colour ──────────────────────────
   dot  = ring color on the dot node
   pill = background / text on the label chip
*/
const DOT_CLASS: Record<string, string> = {
  commitment_met: "bg-tertiary",
  case_closed: "bg-tertiary",
  commitment_breached: "bg-error animate-pulse",
  commitment_at_risk: "bg-error animate-pulse",
  commitment_cancelled: "bg-outline",
  commitment_started: "bg-primary",
  case_created: "bg-primary",
  issue_linked: "bg-leg-engineering",
  state_changed: "bg-outline",
};

const PILL_CLASS: Record<string, string> = {
  commitment_met: "bg-tertiary-container text-on-tertiary-container",
  case_closed: "bg-tertiary-container text-on-tertiary-container",
  commitment_breached: "bg-error-container text-error",
  commitment_at_risk: "bg-error-container text-error",
  issue_linked: "bg-surface-container text-leg-engineering-text",
  commitment_started: "bg-surface-container text-on-surface-variant",
  case_created: "bg-surface-container text-on-surface-variant",
};

const PROVIDER_LABELS = INTEGRATION_PROVIDER_LABELS as Record<string, string>;

/* ─── Event body text ────────────────────────────────────────── */

function EventBody({ event }: { event: TimelineEventDetail }): ReactNode {
  if (event.type === "state_changed" && event.fromState && event.toState) {
    return (
      <span className="text-sm font-medium text-on-surface">
        {formatNormalizedState(event.fromState)}{" "}
        <span className="text-outline">→</span>{" "}
        {formatNormalizedState(event.toState)}
      </span>
    );
  }

  if (event.type === "case_created") {
    return (
      <span className="text-sm font-medium text-on-surface">
        Opened as
        {event.toState ? ` ${formatNormalizedState(event.toState)}` : ""}
      </span>
    );
  }

  if (event.type === "priority_changed") {
    return (
      <span className="text-sm font-medium text-on-surface">
        Priority changed
        {event.fromState ? ` from ${event.fromState}` : ""}
        {event.toState ? ` to ${event.toState}` : ""}
      </span>
    );
  }

  if (event.type === "policy_changed") {
    return (
      <span className="text-sm font-medium text-on-surface">
        Policy re-matched
        {event.commitmentKind
          ? ` · ${formatCommitmentKind(event.commitmentKind)}`
          : ""}
        {event.previousTargetMinutes !== undefined &&
        event.newTargetMinutes !== undefined
          ? ` — target ${formatMinutes(event.previousTargetMinutes)} → ${formatMinutes(event.newTargetMinutes)}`
          : ""}
      </span>
    );
  }

  if (event.type === "commitment_at_risk") {
    return (
      <span className="text-sm font-medium text-error">
        At risk
        {event.thresholdPercent !== undefined
          ? ` (${event.thresholdPercent}% of target used)`
          : ""}
        {event.commitmentKind
          ? ` · ${formatCommitmentKind(event.commitmentKind)}`
          : ""}
      </span>
    );
  }

  if (event.type === "commitment_breached") {
    return (
      <span className="text-sm font-medium text-error">
        Breached
        {event.commitmentKind
          ? ` · ${formatCommitmentKind(event.commitmentKind)}`
          : ""}
      </span>
    );
  }

  if (event.type === "commitment_met") {
    return (
      <span className="text-sm font-medium text-on-surface">
        {event.commitmentKind
          ? formatCommitmentKind(event.commitmentKind)
          : "Commitment"}{" "}
        SLA Met
      </span>
    );
  }

  if (event.type === "commitment_started") {
    return (
      <span className="text-sm font-medium text-on-surface">
        Commitment started
        {event.commitmentKind
          ? ` · ${formatCommitmentKind(event.commitmentKind)}`
          : ""}
      </span>
    );
  }

  const labels: Record<string, string> = {
    issue_linked: "Escalated & Linked to Engineering Issue",
    issue_unlinked: "Engineering Issue Unlinked",
    case_closed: "Case Closed",
    agent_replied: "First Response Sent",
    customer_replied: "Customer Replied",
    commitment_cancelled: "Commitment Cancelled",
  };

  return (
    <span className="text-sm font-medium text-on-surface">
      {labels[event.type] ?? event.type}
    </span>
  );
}

function EventDescription({
  event,
}: {
  event: TimelineEventDetail;
}): ReactNode {
  if (event.type === "issue_linked") {
    return (
      <span className="text-xs text-outline">
        Engineering leg started. Customer SLA clock continues running.
      </span>
    );
  }
  if (event.type === "commitment_at_risk") {
    return (
      <span className="text-xs text-outline">
        Automated alerts broadcasted across linked channels.
      </span>
    );
  }
  if (event.type === "agent_replied") {
    return (
      <span className="text-xs text-outline">
        {formatActor(event.actor)} replied.
      </span>
    );
  }
  return null;
}

/* ─── Component ──────────────────────────────────────────────── */

export function ActivityTimeline({ data }: { data: CaseDetailData }) {
  const lastEvent = data.timeline[data.timeline.length - 1];
  const { containerRef, onScroll } = useStickToBottom<HTMLOListElement>(
    lastEvent?.id ?? "",
  );

  return (
    <div>
      <div className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-6 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between">
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
          /* Vertical dot-track container */
          <ol
            ref={containerRef}
            onScroll={onScroll}
            className="relative max-h-144 overflow-y-auto pl-6 flex flex-col gap-5"
          >
            {data.timeline.map((event, index) => {
              const isLast = index === data.timeline.length - 1;
              const dotClass = DOT_CLASS[event.type] ?? "bg-outline";
              const pillClass =
                PILL_CLASS[event.type] ??
                "bg-surface-container text-on-surface-variant";
              const pillLabel =
                EVENT_TYPE_PILL_LABEL[event.type] ??
                event.type.replace(/_/g, " ").toUpperCase();

              return (
                <li
                  key={event.id}
                  className={cn(
                    "relative flex flex-col",
                    !isLast &&
                      "before:absolute before:-start-4.75 before:top-2.5 before:-bottom-5 before:w-0.5 before:bg-surface-container-high",
                  )}
                >
                  {/* Dot node */}
                  <div
                    className={cn(
                      "absolute -start-6 top-1 size-3 rounded-full ring-4 ring-surface-container-low",
                      dotClass,
                      isLast && "animate-pulse",
                    )}
                  />

                  {/* Timestamp row + pill */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium text-primary">
                      {formatDateTime(event.occurredAt)}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider",
                        pillClass,
                      )}
                    >
                      {pillLabel}
                    </span>
                  </div>

                  {/* Event body */}
                  <div className="mt-0.5 text-sm leading-5">
                    <EventBody event={event} />
                  </div>

                  {/* Description */}
                  <div className="mt-0.5 text-xs leading-4">
                    <EventDescription event={event} />
                  </div>

                  {/* Actor + provider — small meta line */}
                  <div className="mt-1 flex items-center gap-2 text-xxs leading-3.5 text-outline">
                    <span>{formatActor(event.actor)}</span>
                    <span>·</span>
                    <span>{PROVIDER_LABELS[event.system] ?? event.system}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-surface-container-low p-6 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="size-5.5 text-error" />
            <h2 className="text-xl font-medium tracking-tight text-on-surface">
              Escalation Dispatch Log
            </h2>
          </div>
          <span className="font-mono text-xs leading-4 text-outline">
            0 Dispatches
          </span>
        </div>

        <div className="rounded-lg bg-surface-container p-3 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Bell className="size-4.5 text-outline mt-0.5" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-on-surface">
                No escalation dispatch records
              </span>
              <span className="text-xs leading-4.5 text-outline">
                Dispatch history is not included in the current case-detail data
                contract.
              </span>
            </div>
          </div>
          <span className="font-mono text-xs leading-4 text-outline">
            NOT AVAILABLE
          </span>
        </div>

        <Button
          type="button"
          variant="bare"
          size="bare"
          disabled
          className="bg-surface-container text-outline w-full cursor-not-allowed gap-1.5 rounded px-4 py-2 text-xs leading-4.5 font-medium disabled:opacity-60"
        >
          <Bell className="size-4" />
          Re-trigger Escalation Ping to Eng On-Call
        </Button>
      </div>
    </div>
  );
}
