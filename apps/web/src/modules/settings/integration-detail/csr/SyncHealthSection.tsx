import {
  ArrowRightLeft,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { PermissionDeniedBanner } from "@/components/shared/permission-denied-banner";
import { PollingPausedBanner } from "@/components/shared/polling-paused-banner";
import { cn, Utils } from "@/lib/utils";
import type { IntegrationDetailData } from "@/lib/types/integrations";
import {
  BadgeDot,
  descriptionClass,
  labelClass,
  panelClass,
  SectionBadge,
  SectionCard,
} from "./detail-primitives";

/** Polling, last sync outcome and token health — with the paused / access banners when they apply. */
export function SyncHealthSection({
  data,
  label,
}: {
  data: IntegrationDetailData;
  label: string;
}) {
  const {
    provider,
    reauthRequired,
    permissionDenied,
    pollingPaused,
    lastSyncAt,
    lastSyncError,
    backfillCompletedAt,
  } = data;
  const unhealthy = reauthRequired || permissionDenied || !!lastSyncError;

  return (
    <SectionCard
      icon={<ArrowRightLeft className="size-4" />}
      title="Sync health & connection state"
      description="Continuous polling and token lifecycle verification"
      badge={
        <SectionBadge tone={unhealthy ? "warning" : "success"}>
          <BadgeDot tone={unhealthy ? "warning" : "success"} />
          {unhealthy ? "Needs attention" : "Healthy"}
        </SectionBadge>
      }
    >
      {pollingPaused && <PollingPausedBanner provider={label} />}

      {permissionDenied && !reauthRequired && (
        <PermissionDeniedBanner provider={label} />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={panelClass}>
          <span className={labelClass}>Last ingress cycle</span>
          <span className="text-primary font-mono text-sm font-semibold">
            {lastSyncAt
              ? Utils.formatDateTimeV2(lastSyncAt)
              : "No sync attempt yet"}
          </span>
          <p className={descriptionClass}>
            {backfillCompletedAt
              ? `90-day backfill complete as of ${Utils.formatDateTimeV2(
                  backfillCompletedAt,
                )}.`
              : "No backfill run yet."}
          </p>
        </div>

        <div className={panelClass}>
          <span className={labelClass}>Diagnostic log</span>
          <div className="bg-surface-container-highest flex items-start gap-3 rounded p-3">
            {lastSyncError ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-error" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-tertiary" />
            )}
            <span className="wrap-break-word font-mono text-xs text-on-surface">
              {lastSyncError
                ? lastSyncError
                : lastSyncAt
                  ? "Last sync succeeded. No errors recorded."
                  : "Waiting for the first sync."}
            </span>
          </div>
        </div>
      </div>

      <div className={panelClass}>
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <span className="text-on-surface font-mono text-sm font-medium">
            {provider === "github" ? "Access" : "OAuth 2.0"} authorization
          </span>
        </div>
        <div className="flex items-start gap-2 rounded bg-surface-container-highest p-3">
          <ShieldCheck
            className={cn(
              "mt-0.5 size-4 shrink-0",
              reauthRequired || permissionDenied
                ? "text-error"
                : "text-tertiary",
            )}
          />
          <span className={descriptionClass}>
            {reauthRequired
              ? "Authorization expired or was revoked — reconnect to resume syncing."
              : permissionDenied
                ? "The token works, but the connecting user lost access on the provider side."
                : "Authorization healthy. No re-authentication needed."}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
