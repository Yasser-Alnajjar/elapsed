"use client";

import { useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { PermissionDeniedMessage } from "@/components/shared/permission-denied-banner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TONE_DOT, TONE_TEXT } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import type {
  IntegrationConfigStatus,
  IntegrationConnectionView,
} from "@/lib/types/integrations";

const statusToneClasses = {
  success: { dot: TONE_DOT.success, text: TONE_TEXT.success },
  warning: { dot: TONE_DOT.warning, text: TONE_TEXT.warning },
  muted: { dot: "bg-muted-foreground/60", text: "text-on-surface-variant" },
} as const;

export function StatusIndicator({
  tone,
  label,
  icon,
}: {
  tone: keyof typeof statusToneClasses;
  label: string;
  /** Replaces the status dot — e.g. the warning icon on a hover-explained status. */
  icon?: ReactNode;
}) {
  const { dot, text } = statusToneClasses[tone];

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded px-2 py-1",
        tone === "success" ? "bg-success/10" : "bg-surface-container",
      )}
    >
      {icon ?? (
        <span
          className={cn(
            "size-1.5 rounded-full",
            dot,
            tone === "success" && "animate-pulse",
          )}
        />
      )}
      <span className={cn("font-mono text-xxs font-semibold", text)}>
        {label}
      </span>
    </span>
  );
}

/** "Access restricted" status — hovering (or tapping) it explains the warning in a popover. */
function PermissionDeniedStatus({ providerLabel }: { providerLabel: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="cursor-help rounded"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <StatusIndicator
          tone="warning"
          label="Access restricted"
          icon={<ShieldAlert className="text-warning size-3" />}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="text-warning-text w-80 text-xs "
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <PermissionDeniedMessage provider={providerLabel} />
      </PopoverContent>
    </Popover>
  );
}

function ConnectedStatus({
  view,
  providerLabel,
}: {
  view: IntegrationConnectionView;
  providerLabel: string;
}) {
  if (view.reauthRequired) {
    return <StatusIndicator tone="warning" label="Needs reconnect" />;
  }
  if (view.permissionDenied) {
    return <PermissionDeniedStatus providerLabel={providerLabel} />;
  }
  return <StatusIndicator tone="success" label="Connected" />;
}

/**
 * A source provider's card status: nothing until its OAuth app is
 * configured, then its connection health, or "Disconnected" once it has
 * been connected before.
 */
export function ProviderConnectionStatus({
  view,
  config,
  providerLabel,
}: {
  view: IntegrationConnectionView;
  config: IntegrationConfigStatus;
  providerLabel: string;
}) {
  if (!config.configured) return null;
  if (view.connected) {
    return <ConnectedStatus view={view} providerLabel={providerLabel} />;
  }
  if (view.disconnectedAt) {
    return <StatusIndicator tone="muted" label="Disconnected" />;
  }
  return null;
}
