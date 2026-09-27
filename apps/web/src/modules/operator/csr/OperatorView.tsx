"use client";

import { CheckCircle2, PlugZap, RefreshCw, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCommitmentKind, formatExactTimestamp } from "@/lib/format";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import type { OperatorMonitoringData } from "@/lib/types/operator";

interface OperatorViewProps {
  data: OperatorMonitoringData;
}

/**
 * Platform-operator monitoring view (roadmap 7.5) — the only page that
 * spans every organization on the deployment rather than the signed-in
 * user's own. Same "blind spots" framing as the org-scoped dashboard panel
 * (Phase 6.3/6.4), just unscoped: failed webhooks/syncs surface here as
 * unhealthy `Integration` rows, failed alert deliveries as
 * `NotificationFailure` rows, each labeled with the organization it belongs
 * to. Only reachable by `PLATFORM_ADMIN_EMAILS` — see `OperatorActions.getData`.
 */
export function OperatorView({ data }: OperatorViewProps) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Operator Monitoring
          </h1>
          <Badge variant="tertiary">{data.organizationCount} organizations</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-5 text-muted-foreground">
          Failed webhook/sync integrations and failed alert deliveries across
          every organization on this deployment — not just your own.
        </p>
      </header>

      <div className="bg-surface-container-low shadow-soft flex flex-col gap-5 overflow-hidden rounded-xl p-4">
        <SubSection
          icon={PlugZap}
          title="Integration health"
          description="Re-auth needed, lost provider access, or the last sync failed — any organization"
          badge={
            data.unhealthyIntegrations.length > 0 && (
              <span className="bg-error/15 text-error rounded px-2 py-0.5 font-mono text-xs">
                {data.unhealthyIntegrations.length}
              </span>
            )
          }
        >
          {data.unhealthyIntegrations.length === 0 ? (
            <p className="text-outline flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="text-tertiary size-3.5" />
              Every integration on every organization is syncing cleanly.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.unhealthyIntegrations.map((row) => (
                <li
                  key={`${row.organizationId}:${row.provider}`}
                  className="flex flex-col gap-0.5 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-on-surface font-medium">
                      {row.organizationName ?? row.organizationId} ·{" "}
                      {INTEGRATION_PROVIDER_LABELS[row.provider]}
                    </span>
                    <span className="text-outline shrink-0 font-mono text-xxs">
                      {row.lastSyncAt ? formatExactTimestamp(row.lastSyncAt) : "Never synced"}
                    </span>
                  </div>
                  <span className="text-error text-xs">
                    {row.reauthRequired
                      ? "Re-authentication required"
                      : row.permissionDenied
                        ? "Provider-side access lost (permission denied)"
                        : `Last sync failed: ${row.lastSyncError}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SubSection>

        <SubSection
          icon={ShieldAlert}
          title="Failed alert deliveries"
          description="Every configured channel has failed at least once for this alert — any organization"
          badge={
            data.failedAlerts.length > 0 && (
              <span className="bg-error/15 text-error rounded px-2 py-0.5 font-mono text-xs">
                {data.failedAlerts.length + data.failedAlertsOverflowCount}
              </span>
            )
          }
        >
          {data.failedAlerts.length === 0 ? (
            <p className="text-outline flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="text-tertiary size-3.5" />
              No alert deliveries are currently failing.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.failedAlerts.map((row) => (
                <li key={`${row.commitmentId}:${row.threshold}`} className="flex flex-col gap-0.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <a href={`/cases/${row.caseId}`} className="text-primary truncate hover:underline">
                      {row.organizationName ?? row.organizationId} · #{row.externalId} ·{" "}
                      {formatCommitmentKind(row.kind)} @ {row.threshold}%
                    </a>
                    <span className="text-outline shrink-0 font-mono text-xxs">
                      {row.attempts} attempt{row.attempts !== 1 ? "s" : ""} since{" "}
                      {formatExactTimestamp(row.firstFailedAt)}
                    </span>
                  </div>
                  <span className="text-error truncate text-xs">{row.error}</span>
                </li>
              ))}
              {data.failedAlertsOverflowCount > 0 && (
                <li className="text-outline text-xs">+{data.failedAlertsOverflowCount} more.</li>
              )}
            </ul>
          )}
        </SubSection>
      </div>

      <Button
        type="button"
        variant="link"
        onClick={() => router.refresh()}
        className="h-auto gap-1.5 p-0 text-xs font-normal text-on-surface-variant underline-offset-0 hover:text-foreground hover:no-underline [&_svg]:size-3"
      >
        <RefreshCw className="size-3" />
        Refresh · as of {formatExactTimestamp(data.asOf)}
      </Button>
    </div>
  );
}

function SubSection({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="text-outline size-4" />
          <div>
            <h4 className="text-on-surface text-sm font-medium">{title}</h4>
            <p className="text-outline text-xs">{description}</p>
          </div>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}
