"use client";

import {
  Archive,
  CircleAlert,
  CircleCheckBig,
  Database,
  Hourglass,
  Link,
  Lock,
  Network,
  RefreshCw,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import type { OnboardingStatus } from "@/lib/types/onboarding";

interface OnboardingProgressProps {
  status: OnboardingStatus;
  /** The ticket source being ingested ("Zendesk" | "Intercom") and its backfill state. */
  sourceLabel: string;
  sourceRunning: boolean;
  /** The connected tracker ("Jira" | "Linear"), or null before step 3. */
  trackerLabel: string | null;
  trackerRunning: boolean;
  error: string | null;
}

interface StatCardSpec {
  key: "ticketsFetched" | "escalatedCases" | "linkedIssues";
  icon: LucideIcon;
  label: string;
  description: string;
}

const statCards: StatCardSpec[] = [
  {
    key: "ticketsFetched",
    icon: Archive,
    label: "Tickets ingested",
    description: "Normalized across the 90-day backfill window",
  },
  {
    key: "escalatedCases",
    icon: Hourglass,
    label: "Escalated cases",
    description: "Cases with at least one engineering handoff",
  },
  {
    key: "linkedIssues",
    icon: Workflow,
    label: "Linked issues",
    description: "Resolved via official remote issue links",
  },
];

/** One line in the ingestion ledger — real, derived state only, never fabricated per-ticket detail. */
interface LedgerEntry {
  icon: LucideIcon;
  tone: "primary" | "tertiary" | "secondary" | "muted";
  text: string;
}

function buildLedger({
  status,
  sourceLabel,
  sourceRunning,
  trackerLabel,
  trackerRunning,
}: Pick<
  OnboardingProgressProps,
  "status" | "sourceLabel" | "sourceRunning" | "trackerLabel" | "trackerRunning"
>): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    {
      icon: Network,
      tone: "primary",
      text: `Read-only handshake established with your ${sourceLabel} workspace`,
    },
  ];

  if (status.ticketsFetched > 0) {
    entries.push({
      icon: Archive,
      tone: "primary",
      text: `${status.ticketsFetched.toLocaleString()} tickets ingested and normalized so far`,
    });
  } else if (sourceRunning) {
    entries.push({
      icon: RefreshCw,
      tone: "muted",
      text: "Fetching the 90-day ticket index…",
    });
  }

  if (status.escalatedCases > 0) {
    entries.push({
      icon: CircleAlert,
      tone: "secondary",
      text: `${status.escalatedCases.toLocaleString()} escalated case${
        status.escalatedCases === 1 ? "" : "s"
      } identified with an engineering handoff`,
    });
  }

  if (status.linkedIssues > 0) {
    entries.push({
      icon: Link,
      tone: "tertiary",
      text: `${status.linkedIssues.toLocaleString()} ${trackerLabel ?? "engineering"} issue link${
        status.linkedIssues === 1 ? "" : "s"
      } resolved deterministically`,
    });
  } else if (trackerRunning) {
    entries.push({
      icon: RefreshCw,
      tone: "muted",
      text: `Correlating escalated cases against ${trackerLabel} links…`,
    });
  }

  if (!sourceRunning) {
    entries.push({
      icon: CircleCheckBig,
      tone: "tertiary",
      text: trackerRunning
        ? `${sourceLabel} backfill complete — ${trackerLabel} is still catching up in the background`
        : `${sourceLabel} backfill complete`,
    });
  }

  return entries;
}

const LEDGER_TONE_CLASS: Record<LedgerEntry["tone"], string> = {
  primary: "text-primary",
  tertiary: "text-tertiary",
  secondary: "text-secondary",
  muted: "text-on-surface-variant/70",
};

export function OnboardingProgress({
  status,
  sourceLabel,
  sourceRunning,
  trackerLabel,
  trackerRunning,
  error,
}: OnboardingProgressProps) {
  const running = sourceRunning || trackerRunning;
  const ledger = buildLedger({ status, sourceLabel, sourceRunning, trackerLabel, trackerRunning });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-label-caps text-label-caps rounded bg-surface-container-high px-1.5 py-0.5 uppercase tracking-wider text-primary">
          Stage 02 // Historical backfill
        </span>
        <span
          className={`size-1.5 rounded-full bg-tertiary ${running ? "animate-ping" : ""}`}
        />
        <span className="font-code-audit text-code-audit text-tertiary">
          {running ? "KERNEL_STATUS: REPLAYING_RECORDS" : "KERNEL_STATUS: SYNCED"}
        </span>
      </div>

      <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-lg bg-surface-container-low p-3.5">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-primary/10 blur-3xl"
        />

        <div className="z-10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {running ? (
              <RefreshCw className="size-[18px] shrink-0 animate-spin text-primary" />
            ) : (
              <Database className="size-[18px] shrink-0 text-primary" />
            )}
            <span className="font-mono-metric-md text-mono-metric-md text-on-surface">
              {running
                ? "Replaying ticket history — parsing timestamps and handoffs…"
                : "Historical backfill complete"}
            </span>
          </div>
          {!running && (
            <span className="font-label-caps text-label-caps shrink-0 rounded bg-tertiary/10 px-1.5 py-0.5 uppercase text-tertiary">
              Zero errors
            </span>
          )}
        </div>

        <div className="z-10 h-2 w-full overflow-hidden rounded-full bg-surface-container-lowest p-0.5">
          <div
            className={`h-full rounded-full bg-gradient-to-r from-primary via-primary-fixed-dim to-tertiary transition-all duration-300 ${
              running ? "w-2/3 animate-pulse" : "w-full"
            }`}
          />
        </div>

        {/* Ingestion ledger — a terminal-styled log of real, derived state (never fabricated per-ticket entries). */}
        <div className="z-10 flex flex-col gap-1 rounded bg-surface-container-lowest p-2.5 font-code-audit text-code-audit">
          {ledger.map(({ icon: Icon, tone, text }, index) => (
            <div
              key={`${text}-${index}`}
              className="flex items-start gap-2 text-on-surface-variant/80"
            >
              <Icon
                className={`mt-0.5 size-3.5 shrink-0 ${LEDGER_TONE_CLASS[tone]}`}
              />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {statCards.map(({ key, icon: Icon, label, description }) => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-container-lowest p-3"
          >
            <div className="flex items-center gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded bg-surface-container-high text-primary">
                <Icon className="size-4" />
              </div>
              <p className="font-mono-metric-lg text-mono-metric-lg text-on-surface">
                {status[key].toLocaleString()}
              </p>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                {label}
              </p>
              <p className="font-body-sm text-body-sm text-on-surface-variant/80">
                {description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-surface-container-lowest px-3 py-2 text-on-surface-variant/70">
        <Lock className="size-4 shrink-0" />
        <span className="font-code-audit text-code-audit">
          Read-only ingestion — Elapsed never writes back to {sourceLabel}
          {trackerLabel ? ` or ${trackerLabel}` : ""}
        </span>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert className="size-[18px]" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
