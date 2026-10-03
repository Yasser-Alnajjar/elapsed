"use client";

import {
  ArrowLeftRight,
  BadgeCheck,
  CircleCheck,
  CircleUser,
  Inbox,
  Sparkles,
  Timer,
  TriangleAlert,
  Unlink,
  UserX,
  type LucideIcon,
} from "lucide-react";

import Link from "next/link";
import type { ReactNode } from "react";
import type { CommitmentKind } from "@sla/core";

import { CountdownClock } from "@/components/shared/countdown-clock";
import { PriorityTierChip } from "@/components/shared/priority-tier-chip";
import { StatusBadge } from "@/components/shared/status-badge";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatCommitmentKind,
  formatCommitmentStatus,
  formatLinkedSystemShort,
  formatMinutes,
} from "@/lib/format";
import { commitmentStatusStyle } from "@/lib/status-styles";
import type { CaseListRow } from "@/lib/types/cases";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/** "Priority & Dual-Key" — severity chip over the Zendesk⇄Jira id pairing. */
export function PriorityDualKeyCell({ row }: { row: CaseListRow }) {
  const link = row.primaryLink;

  return (
    <div className="flex items-center whitespace-nowrap gap-2">
      <PriorityTierChip priority={row.priority} />
      <div className="flex flex-col">
        <div className="flex items-center gap-1 font-mono text-sm font-medium text-on-surface group-hover:text-primary">
          <span>#{row.externalId}</span>
          {link && (
            <>
              <ArrowLeftRight aria-hidden className="size-3.25 shrink-0 text-tertiary" />
              <span className="font-semibold text-primary">
                {formatLinkedSystemShort(link.system)}-
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
        <span className="truncate text-xs font-semibold text-on-surface">
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
            className="mt-0.5 block min-w-0 truncate text-sm! text-on-surface-variant hover:text-primary hover:underline"
          >
            {row.subject ?? `#${row.externalId}`}
          </Link>
        </TooltipTrigger>
        <TooltipContent>{row.subject ?? `#${row.externalId}`}</TooltipContent>
      </Tooltip>
      <div className="mt-1 flex items-center gap-2">
        <span className="flex items-center gap-1 font-mono text-xxs text-outline">
          <Inbox aria-hidden className="size-2.75 shrink-0 text-outline" />
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
      {isCertain ? (
        <BadgeCheck aria-hidden className="size-3.25 shrink-0" />
      ) : (
        <Sparkles aria-hidden className="size-3.25 shrink-0" />
      )}
      <span className="leading-tight">
        Linked — {isCertain ? "Certain" : link.confidence}
      </span>
    </Badge>
  );
}

/** The shared shape of both runway cells: kind + status chip, a value line, and a consumption bar. */
function RunwayFrame({
  kind,
  targetMinutes,
  status,
  icon: Icon,
  percent,
  children,
}: {
  kind: CommitmentKind;
  targetMinutes: number;
  status: string;
  icon: LucideIcon;
  percent: number;
  children: ReactNode;
}) {
  const style = commitmentStatusStyle(status);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-on-surface-variant text-nowrap">
          {formatCommitmentKind(kind)} ({formatMinutes(targetMinutes)} Max)
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-xxs font-semibold tracking-wider uppercase",
            style.chip,
            status === "at_risk" && "animate-pulse",
          )}
        >
          {formatCommitmentStatus(status)}
        </span>
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 font-mono text-sm font-semibold",
          style.text,
        )}
      >
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {children}
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
        <div
          className={cn("h-full rounded-full", style.fill)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

/** Final outcome for a case with no live clock: elapsed vs. target with a progress bar. */
function SettledRunway({
  settled,
}: {
  settled: NonNullable<CaseListRow["settledCommitment"]>;
}) {
  const targetSeconds = settled.targetMinutes * 60;
  const elapsedSeconds = settled.elapsedSeconds ?? 0;
  const percent =
    targetSeconds > 0 ? (elapsedSeconds / targetSeconds) * 100 : 0;
  const overBy = elapsedSeconds - targetSeconds;

  return (
    <RunwayFrame
      kind={settled.kind}
      targetMinutes={settled.targetMinutes}
      status={settled.status}
      icon={settled.status === "breached" ? TriangleAlert : CircleCheck}
      percent={percent}
    >
      <span>
        {settled.elapsedSeconds == null
          ? "—"
          : settled.status === "breached" && overBy > 0
            ? `+${formatMinutes(Math.ceil(overBy / 60))} over`
            : `${formatMinutes(Math.max(0, Math.round(elapsedSeconds / 60)))} used`}
      </span>
    </RunwayFrame>
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

  return (
    <RunwayFrame
      kind={live.kind}
      targetMinutes={live.targetMinutes}
      status={live.status}
      icon={
        live.status === "breached"
          ? TriangleAlert
          : live.status === "met"
            ? CircleCheck
            : Timer
      }
      percent={percentExpended}
    >
      <CountdownClock
        remainingMinutes={live.remainingMinutes}
        className="font-mono"
      />
    </RunwayFrame>
  );
}

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
        {row.assigneeName ? (
          <CircleUser aria-hidden className="size-3.5 shrink-0 text-outline" />
        ) : (
          <UserX aria-hidden className="size-3.5 shrink-0 text-outline" />
        )}
        {row.assigneeName ? (
          <span className="max-w-27.5 truncate">{row.assigneeName}</span>
        ) : (
          <span className="italic text-error">Unassigned</span>
        )}
      </span>
    </div>
  );
}
