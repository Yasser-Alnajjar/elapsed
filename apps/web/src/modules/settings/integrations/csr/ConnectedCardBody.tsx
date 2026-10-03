import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PollingPausedBanner } from "@/components/shared/polling-paused-banner";
import { Button } from "@/components/ui/button";
import { TONE_TEXT } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import type { IntegrationProvider } from "@/lib/types/integrations";
import { DisconnectButton } from "./DisconnectButton";
import { descriptionClass, formatDateTime } from "./card-format";

interface PulseStat {
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "warning" | "primary" | "default";
}

export interface PulsePanelProps {
  title: string;
  health: string;
  healthTone: "success" | "warning";
  healthIcon: ReactNode;
  stats: PulseStat[];
}

const pulseToneClass = {
  success: "text-success",
  warning: "text-warning",
  primary: "text-primary",
  default: "text-on-surface",
} as const;

/** Design "pulse" panel: title row with a health label, then three mono stats. */
function PulsePanel({
  title,
  health,
  healthTone,
  healthIcon,
  stats,
}: PulsePanelProps) {
  return (
    <div className="bg-surface-container border-outline-variant/20 flex flex-col gap-2 rounded-lg border p-4">
      <div className="text-outline border-outline-variant/20 flex items-center justify-between border-b pb-1.5 font-mono text-xxs">
        <span className="uppercase tracking-wider">{title}</span>
        <span
          className={cn(
            "flex items-center gap-1 font-semibold",
            TONE_TEXT[healthTone],
          )}
        >
          {healthIcon} {health}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col">
            <span className="text-outline truncate font-mono text-xxs uppercase">
              {stat.label}
            </span>
            <span
              className={cn(
                "mt-0.5 truncate font-mono text-sm font-bold",
                pulseToneClass[stat.tone ?? "default"],
              )}
            >
              {stat.value}
            </span>
            <span className="text-on-surface-variant truncate font-mono text-xxs">
              {stat.hint}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The wrapped row of small facts under a connected card's title. */
export function MetaLine({ children }: { children: ReactNode }) {
  return (
    <div className="text-on-surface-variant flex flex-wrap items-center gap-1.5 text-xs">
      {children}
    </div>
  );
}

/**
 * A connected integration's card: meta line, optional pulse panel, and a
 * footer with Disconnect, an optional extra action and Manage. Backfill,
 * webhooks and sync health live on `/settings/integrations/[provider]`.
 */
export function ConnectedCardBody({
  provider,
  providerLabel,
  connectedAt,
  disconnectHint,
  pollingPaused = false,
  meta,
  pulse,
  extra,
}: {
  provider: IntegrationProvider;
  providerLabel: string;
  connectedAt: Date;
  disconnectHint?: string;
  /** A platform operator paused polling (N4.5); the customer is told, not left to infer it from stale data. */
  pollingPaused?: boolean;
  meta?: ReactNode;
  pulse?: PulsePanelProps;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <MetaLine>
        <span className="font-mono text-xxs">
          {new Date(connectedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        {meta}
      </MetaLine>
      {pollingPaused && <PollingPausedBanner provider={providerLabel} />}
      {pulse ? (
        <PulsePanel {...pulse} />
      ) : (
        <p className={descriptionClass}>
          Connected {formatDateTime(connectedAt)}.
          {disconnectHint && ` ${disconnectHint}`}
        </p>
      )}

      <div className="border-outline-variant/20 mt-auto flex items-center justify-between border-t pt-2">
        <DisconnectButton provider={provider} providerLabel={providerLabel} />
        <div className="flex items-center gap-1.5">
          {extra}
          <Button variant="surface" className="text-nowrap" size="sm" asChild>
            <Link href={`/settings/integrations/${provider}`}>
              Manage
              <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
