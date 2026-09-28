"use client";

import {
  ArrowLeftRight,
  BadgeCheck,
  CircleCheck,
  CircleUser,
  Hourglass,
  Inbox,
  Sparkles,
  Timer,
  TriangleAlert,
  Unlink,
  UserX,
  type LucideIcon,
} from "lucide-react";

import Link from "next/link";

import { CountdownClock } from "@/components/shared/countdown-clock";
import { StatusBadge } from "@/components/shared/status-badge";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatCommitmentKind,
  formatMinutes,
  formatPriorityTier,
} from "@/lib/format";
import type { CaseListRow } from "@/lib/types/cases";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const MS_ICONS: Record<string, LucideIcon> = {
  sync_alt: ArrowLeftRight,
  inbox: Inbox,
  verified: BadgeCheck,
  pattern: Sparkles,
  warning: TriangleAlert,
  task_alt: CircleCheck,
  timer: Timer,
  hourglass_bottom: Hourglass,
  account_circle: CircleUser,
  person_off: UserX,
};

/** Stitch's Material Symbol names, rendered with lucide (the font isn't loaded). */
export function Ms({ name, className }: { name: string; className?: string }) {
  const Icon = MS_ICONS[name] ?? Timer;
  return <Icon aria-hidden className={cn("shrink-0", className)} />;
}

const LINKED_SYSTEM_LABEL: Record<string, string> = {
  jira: "ENG",
  linear: "LIN",
  github: "GH",
};

const SEVERITY_TONE: Record<string, string> = {
  P1: "bg-error-container/30 text-error",
  P2: "bg-warning/10 text-warning",
  P3: "bg-surface-container-highest text-on-surface-variant",
  P4: "bg-surface-subtle text-muted-foreground",
};

/** "Priority & Dual-Key" — severity chip over the Zendesk⇄Jira id pairing. */
export function PriorityDualKeyCell({ row }: { row: CaseListRow }) {
  const severity = formatPriorityTier(row.priority);
  const link = row.primaryLink;

  return (
    <div className="flex items-center whitespace-nowrap gap-2">
      {severity && (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 font-mono text-xxs font-semibold tracking-wider uppercase",
            SEVERITY_TONE[severity],
          )}
        >
          {severity} - {row.priority}
        </span>
      )}
      <div className="flex flex-col">
        <div className="flex items-center gap-1 font-mono text-sm font-medium text-on-surface group-hover:text-primary">
          <span>#{row.externalId}</span>
          {link && (
            <>
              <Ms name={"sync_alt"} className="size-3.25 text-tertiary" />
              <span className="font-semibold text-primary">
                {LINKED_SYSTEM_LABEL[link.system] ?? link.system.toUpperCase()}-
                {link.externalId}
              </span>
            </>
          )}
        </div>
        <span className="font-mono text-xxs text-outline">
          {link ? `synced · ${link.statusName ?? "linked"}` : "standalone"}
        </span>
      </div>
    </div>
  );
}

/** "Customer & Subject". */
export function CustomerSubjectCell({ row }: { row: CaseListRow }) {
  return (
    <div className="flex max-w-47.5 min-w-0 flex-col">
      <div className="flex items-center gap-1">
        <span className=" text-sm font-semibold text-on-surface truncate">
          {row.customerName ?? "—"}
        </span>
        {row.tier && (
          <span className="shrink-0 rounded bg-surface-container-lowest px-1 font-mono text-xxs text-primary">
            {row.tier}
          </span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={`/cases/${row.caseId}`}
            className="mt-0.5 block min-w-0 truncate text-xs text-on-surface-variant hover:text-primary hover:underline"
          >
            {row.subject ?? `#${row.externalId}`}
          </Link>
        </TooltipTrigger>
        <TooltipContent>{row.subject ?? `#${row.externalId}`}</TooltipContent>
      </Tooltip>
      <div className="mt-1 flex items-center gap-2">
        <span className="flex items-center gap-1 font-mono text-xxs text-outline">
          <Ms name={"inbox"} className="size-2.75 text-outline" />
          Zendesk #{row.externalId}
        </span>
      </div>
    </div>
  );
}

/** "Correlation" — link confidence + status caption, when known. */
export function CorrelationCell({ row }: { row: CaseListRow }) {
  const link = row.primaryLink;

  if (!link) {
    return (
      <div className="whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5 rounded bg-surface-container-highest px-2 py-0.5 font-mono text-xxs font-semibold tracking-wider text-outline">
          <Unlink className="size-3" />
          <span>Unlinked</span>
        </div>
        <div className="mt-1 font-mono text-xxs text-outline">Support-only</div>
      </div>
    );
  }

  const isCertain = link.confidence === "certain";

  return (
    <Badge
      variant={isCertain ? "success" : "outline"}
      className="gap-1.5 text-nowrap"
    >
      <Ms name={isCertain ? "verified" : "pattern"} className="size-3.25" />
      <span className="leading-tight">
        Linked — {isCertain ? "Certain" : link.confidence}
      </span>
    </Badge>
  );
}

const SETTLED_TONE: Record<
  string,
  { text: string; bar: string; badge: string; label: string }
> = {
  met: {
    text: "text-tertiary",
    bar: "bg-tertiary",
    badge: "bg-tertiary/20 text-tertiary font-bold",
    label: "MET",
  },
  breached: {
    text: "text-error",
    bar: "bg-error",
    badge: "bg-error-container/20 text-error font-bold",
    label: "BREACHED",
  },
  at_risk: {
    text: "text-warning",
    bar: "bg-warning",
    badge: "bg-error-container text-warning",
    label: "AT RISK",
  },
  on_track: {
    text: "text-primary",
    bar: "bg-primary",
    badge: "bg-primary-container/20 text-primary",
    label: "ON TRACK",
  },
  cancelled: {
    text: "text-outline",
    bar: "bg-outline",
    badge: "bg-surface-container-highest text-outline",
    label: "CANCELLED",
  },
};

/** Final outcome for a case with no live clock: elapsed vs. target with a progress bar. */
export function SettledRunway({
  settled,
}: {
  settled: NonNullable<CaseListRow["settledCommitment"]>;
}) {
  const tone = SETTLED_TONE[settled.status] ?? SETTLED_TONE.on_track!;
  const targetSeconds = settled.targetMinutes * 60;
  const elapsedSeconds = settled.elapsedSeconds ?? 0;
  const percent =
    targetSeconds > 0 ? (elapsedSeconds / targetSeconds) * 100 : 0;
  const overBy = elapsedSeconds - targetSeconds;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-on-surface-variant text-nowrap">
          {formatCommitmentKind(settled.kind)} (
          {formatMinutes(settled.targetMinutes)} Max)
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-xxs font-semibold tracking-wider",
            tone.badge,
          )}
        >
          {tone.label}
        </span>
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 font-mono text-sm font-semibold",
          tone.text,
        )}
      >
        <Ms
          name={settled.status === "breached" ? "warning" : "task_alt"}
          className="size-3.5"
        />
        <span>
          {settled.elapsedSeconds == null
            ? "—"
            : settled.status === "breached" && overBy > 0
              ? `+${formatMinutes(Math.ceil(overBy / 60))} over`
              : `${formatMinutes(Math.max(0, Math.round(elapsedSeconds / 60)))} used`}
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
        <div
          className={cn("h-full rounded-full", tone.bar)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * "SLA Target & Runway" — live for a case with an open commitment,
 * otherwise the persisted worst-of badge.
 */
export function SlaTargetRunwayCell({ row }: { row: CaseListRow }) {
  const live = row.liveCommitment;
  const settled = row.settledCommitment;

  if (!live && settled) return <SettledRunway settled={settled} />;

  if (!live) {
    return row.worstCommitmentStatus ? (
      <StatusBadge status={row.worstCommitmentStatus} />
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  }

  const percentExpended =
    live.targetMinutes > 0
      ? Math.min(100, (live.elapsedSeconds / 60 / live.targetMinutes) * 100)
      : 0;

  const statusTone =
    live.status === "breached"
      ? "text-error"
      : live.status === "at_risk"
        ? "text-error"
        : live.status === "on_track"
          ? "text-primary"
          : "text-tertiary";

  const barTone =
    live.status === "breached"
      ? "bg-error"
      : live.status === "at_risk"
        ? "bg-error"
        : live.status === "on_track"
          ? "bg-primary"
          : "bg-tertiary";

  const statusLabel =
    live.status === "breached"
      ? "BREACHED"
      : live.status === "at_risk"
        ? "AT RISK"
        : live.status === "on_track"
          ? "ON TRACK"
          : "MET";

  const badgeTone =
    live.status === "breached"
      ? "bg-error-container text-error font-bold"
      : live.status === "at_risk"
        ? "bg-error-container text-error"
        : live.status === "on_track"
          ? "bg-primary-container/20 text-primary"
          : "bg-tertiary/20 text-tertiary font-bold";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-on-surface-variant text-nowrap">
          {formatCommitmentKind(live.kind)} ({formatMinutes(live.targetMinutes)}{" "}
          Max)
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-xxs font-semibold tracking-wider",
            badgeTone,
            live.status === "at_risk" && "animate-pulse",
          )}
        >
          {statusLabel}
        </span>
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 font-mono text-sm font-semibold",
          statusTone,
        )}
      >
        <Ms
          name={
            live.status === "breached"
              ? "warning"
              : live.status === "met"
                ? "task_alt"
                : "timer"
          }
          className="size-3.5"
        />
        <CountdownClock
          remainingMinutes={live.remainingMinutes}
          className="font-mono"
        />
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
        <div
          className={cn("h-full rounded-full", barTone)}
          style={{ width: `${percentExpended}%` }}
        />
      </div>
    </div>
  );
}

// "Leg Allocation (Supp↔Eng)" was removed from the case list
// (performance-plan.md Phase 2 item 1): it needs per-case events, which the
// snapshot list no longer loads. Still available live on the case-detail
// page.

/** "Current State & Assignee". */
export function CurrentStateAssigneeCell({ row }: { row: CaseListRow }) {
  const closed = Boolean(row.closedAt);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <span
          className={cn(
            "rounded bg-surface-container-lowest px-1.5 py-0.5 font-mono text-xxs",
            closed ? "text-outline" : "text-on-surface",
          )}
        >
          ZD: {closed ? "Closed" : "Open"}
        </span>
        {row.primaryLink?.statusName && (
          <span
            className={cn(
              "rounded bg-surface-container-lowest px-1.5 py-0.5 font-mono text-xxs",
              row.primaryLink.statusName.toLowerCase().includes("resolved")
                ? "text-tertiary"
                : "text-primary",
            )}
          >
            ENG: {row.primaryLink.statusName}
          </span>
        )}
      </div>
      <span className="mt-0.5 flex items-center gap-1 text-xs text-on-surface-variant">
        <Ms
          name={row.assigneeName ? "account_circle" : "person_off"}
          className="size-3.5 text-outline"
        />
        {row.assigneeName ? (
          <span className="max-w-27.5 truncate">{row.assigneeName}</span>
        ) : (
          <span className="italic text-error">Unassigned</span>
        )}
      </span>
    </div>
  );
}
