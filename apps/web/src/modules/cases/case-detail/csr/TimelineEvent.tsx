"use client";

import type { ReactNode } from "react";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";

import {
  formatActor,
  formatCommitmentKind,
  formatDateTime,
  formatMinutes,
  formatNormalizedState,
} from "@/lib/format";
import { COMMITMENT_STATUS_STYLES, LEG_STYLES } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import type { TimelineEventDetail } from "@/lib/types/cases";

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

const DOT_CLASS: Record<string, string> = {
  commitment_met: COMMITMENT_STATUS_STYLES.met.fill,
  case_closed: "bg-tertiary",
  commitment_breached: cn(
    COMMITMENT_STATUS_STYLES.breached.fill,
    "animate-pulse",
  ),
  commitment_at_risk: cn(
    COMMITMENT_STATUS_STYLES.at_risk.fill,
    "animate-pulse",
  ),
  commitment_cancelled: COMMITMENT_STATUS_STYLES.cancelled.fill,
  commitment_started: "bg-primary",
  case_created: "bg-primary",
  issue_linked: LEG_STYLES.engineering.fill,
  state_changed: "bg-outline",
};

const PILL_CLASS: Record<string, string> = {
  commitment_met: COMMITMENT_STATUS_STYLES.met.chip,
  case_closed: "bg-tertiary-container text-on-tertiary-container",
  commitment_breached: COMMITMENT_STATUS_STYLES.breached.chip,
  commitment_at_risk: COMMITMENT_STATUS_STYLES.at_risk.chip,
  issue_linked: cn("bg-surface-container", LEG_STYLES.engineering.text),
  commitment_started: "bg-surface-container text-on-surface-variant",
  case_created: "bg-surface-container text-on-surface-variant",
};

const PROVIDER_LABELS = INTEGRATION_PROVIDER_LABELS as Record<string, string>;

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

/** One state transition on the vertical dot track: timestamp, type pill, body, and actor/provider meta. */
export function TimelineEventItem({
  event,
  isLast,
}: {
  event: TimelineEventDetail;
  isLast: boolean;
}) {
  const timeZone = useOrgTimezone();
  const dotClass = DOT_CLASS[event.type] ?? "bg-outline";
  const pillClass =
    PILL_CLASS[event.type] ?? "bg-surface-container text-on-surface-variant";
  const pillLabel =
    EVENT_TYPE_PILL_LABEL[event.type] ??
    event.type.replace(/_/g, " ").toUpperCase();

  return (
    <li
      className={cn(
        "relative flex flex-col",
        !isLast &&
          "before:absolute before:-inset-s-4.75 before:top-2.5 before:-bottom-5 before:w-0.5 before:bg-surface-container-high",
      )}
    >
      <div
        className={cn(
          "absolute -inset-s-6 top-1 size-3 rounded-full ring-4 ring-surface-container-low",
          dotClass,
          isLast && "animate-pulse",
        )}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium text-primary">
          {formatDateTime(event.occurredAt, timeZone)}
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

      <div className="mt-0.5 text-sm leading-5">
        <EventBody event={event} />
      </div>

      <div className="mt-0.5 text-xs leading-4">
        <EventDescription event={event} />
      </div>

      <div className="mt-1 flex items-center gap-2 text-xxs leading-3.5 text-outline">
        <span>{formatActor(event.actor)}</span>
        <span>·</span>
        <span>{PROVIDER_LABELS[event.system] ?? event.system}</span>
      </div>
    </li>
  );
}
