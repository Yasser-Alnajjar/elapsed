"use client";

import {
  AlertCircle,
  Fingerprint,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { useAdminOperator } from "@/components/admin/admin-operator-context";
import { MonoLabel, Tag } from "@/components/admin/admin-ui";
import { integrationState } from "@/components/admin/tenant-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type {
  AdminIntegrationDetailRow,
  IntegrationControl,
} from "@/lib/types/admin";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import { cn } from "@/lib/utils";

interface ControlCopy {
  caption: string;
  title: (tenant: string) => string;
  body: (provider: string) => string;
  /** What the customer will notice, or null when nothing changes for them. */
  consequence: ((provider: string) => string) | null;
  confirm: string;
  icon: LucideIcon;
  /** Only pausing has a customer-visible downside; resume and re-normalize are routine. */
  tone: "warning" | "primary";
}

const COPY: Record<IntegrationControl, ControlCopy> = {
  pause_polling: {
    caption: "Operator intervention · recorded in the audit log",
    title: (tenant) => `Pause polling for ${tenant}?`,
    body: (provider) =>
      `The worker stops fetching from ${provider} for this organization until you resume. Evaluation keeps running on the data already stored, but no new data arrives, so the customer sees this integration as stale ("paused by Elapsed support") and breach alerts for its cases are held.`,
    consequence: (provider) =>
      `The customer's ${provider} integration will show as stale, and breach alerts for its cases are held until you resume. Timestamps already stored are not changed.`,
    confirm: "Pause polling",
    icon: Pause,
    tone: "warning",
  },
  resume_polling: {
    caption: "Operator action · recorded in the audit log",
    title: (tenant) => `Resume polling for ${tenant}?`,
    body: (provider) =>
      `The worker fetches from ${provider} again on its next run.`,
    consequence: null,
    confirm: "Resume polling",
    icon: Play,
    tone: "primary",
  },
  request_renormalize: {
    caption: "Operator action · recorded in the audit log",
    title: (tenant) => `Re-normalize ${tenant}?`,
    body: (provider) =>
      `On its next run the worker rebuilds every ${provider} case from the raw events already stored (a full pass instead of the incremental one), then clears the request. It fetches nothing and edits no tenant data.`,
    consequence: null,
    confirm: "Request re-normalization",
    icon: RefreshCw,
    tone: "primary",
  },
};

/**
 * The platform admin's per-integration controls (N4.5): pause or resume
 * polling, and request one full re-normalization. Each is confirmed, scoped to
 * this integration, and audited server-side. The controls never edit a
 * tenant's data.
 */
export function IntegrationControls({
  integration,
  tenantName,
}: {
  integration: AdminIntegrationDetailRow;
  tenantName: string;
}) {
  const label = INTEGRATION_PROVIDER_LABELS[integration.provider];

  if (integration.status === "disconnected") {
    return (
      <p className="text-foreground-subtle font-mono text-xs">
        Disconnected: nothing to poll or re-normalize.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {integration.pollingPausedAt ? (
        <ControlButton
          integration={integration}
          tenantName={tenantName}
          provider={label}
          action="resume_polling"
        />
      ) : (
        <ControlButton
          integration={integration}
          tenantName={tenantName}
          provider={label}
          action="pause_polling"
        />
      )}
      <ControlButton
        integration={integration}
        tenantName={tenantName}
        provider={label}
        action="request_renormalize"
        disabled={integration.renormalizeRequestedAt !== null}
        disabledLabel="Re-normalization requested"
      />
    </div>
  );
}

function ControlButton({
  integration,
  tenantName,
  provider,
  action,
  disabled = false,
  disabledLabel,
}: {
  integration: AdminIntegrationDetailRow;
  tenantName: string;
  provider: string;
  action: IntegrationControl;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const router = useRouter();
  const actorEmail = useAdminOperator();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[action];
  const Icon = copy.icon;
  const warn = copy.tone === "warning";

  async function handleConfirm() {
    setWorking(true);
    setError(null);
    const { ok, body } = await AdminClientActions.controlIntegration(
      integration.id,
      action,
    );
    setWorking(false);
    if (!ok) {
      setError(body.error ?? "The action failed");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const { label: stateLabel, tone: stateTone } = integrationState(integration);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (working) return;
        setOpen(value);
        if (!value) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded border px-3 font-mono text-xxs font-semibold tracking-[0.04em] whitespace-nowrap uppercase transition-colors disabled:pointer-events-none disabled:opacity-50",
            warn
              ? "border-warning/50 text-warning-text hover:bg-warning/10"
              : action === "resume_polling"
                ? "border-primary/50 text-primary hover:bg-primary/10"
                : "border-border text-foreground hover:bg-surface-hover",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {disabled && disabledLabel ? disabledLabel : copy.confirm}
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent
        className={cn(
          "gap-0 overflow-hidden p-0 data-[size=default]:sm:max-w-xl",
          warn ? "border-t-2 border-t-warning" : "border-t-2 border-t-primary",
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded border",
              warn
                ? "border-warning/40 bg-warning/10 text-warning-text"
                : "border-primary/40 bg-primary/10 text-primary",
            )}
          >
            {warn ? (
              <TriangleAlert className="size-5" aria-hidden />
            ) : (
              <Icon className="size-5" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <span
              className={cn(
                "font-mono text-[10px] font-semibold tracking-[0.08em] uppercase",
                warn ? "text-warning-text" : "text-primary",
              )}
            >
              {copy.caption}
            </span>
            <AlertDialogTitle className="text-foreground mt-0.5 text-xl font-semibold tracking-tight">
              {copy.title(tenantName)}
            </AlertDialogTitle>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-5 pb-5">
          <AlertDialogDescription className="bg-surface-raised border-border text-foreground rounded border px-4 py-3 text-sm leading-6">
            {copy.body(provider)}
          </AlertDialogDescription>

          {copy.consequence && (
            <div className="border-warning/35 bg-warning/[0.08] flex items-start gap-3 rounded border px-4 py-3">
              <TriangleAlert
                className="text-warning-text mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <div>
                <span className="text-warning-text font-mono text-[10px] font-semibold tracking-[0.08em] uppercase">
                  Customer-visible consequence
                </span>
                <p className="text-muted-foreground mt-0.5 text-sm leading-5">
                  {copy.consequence(provider)}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <MonoLabel>Integration</MonoLabel>
            <div className="bg-background border-border flex items-center justify-between gap-3 rounded border px-3.5 py-2.5">
              <span className="text-foreground text-sm font-medium">
                {provider}{" "}
                <span className="text-foreground-subtle font-mono text-xs">
                  · {integration.role.replace("_", " ")}
                </span>
              </span>
              <Tag tone={stateTone}>{stateLabel}</Tag>
            </div>
          </div>

          <p className="bg-background border-border text-muted-foreground flex items-start gap-2 rounded border px-3.5 py-2.5 font-mono text-xxs leading-4">
            <Fingerprint className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Recorded in the audit log under{" "}
              <span className="text-foreground font-semibold">
                {actorEmail}
              </span>{" "}
              as <span className="text-primary font-semibold">{action}</span>.
            </span>
          </p>

          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <AlertDialogFooter className="border-border border-t px-5 py-3.5">
          <AlertDialogCancel disabled={working} className="font-mono text-xs">
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant="bare"
            size="bare"
            disabled={working}
            onClick={() => void handleConfirm()}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded px-4 font-mono text-xs font-semibold tracking-[0.04em] uppercase",
              warn
                ? "bg-warning text-warning-foreground hover:brightness-110"
                : "bg-primary text-primary-foreground hover:bg-primary-hover",
            )}
          >
            {working ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Icon className="size-3.5" aria-hidden />
            )}
            {copy.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
