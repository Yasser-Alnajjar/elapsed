"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AuditNotice, CountBadge, MonoLabel, PageHeader, SectionTitle, ZeroState } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { formatUtcTimestamp } from "@/lib/admin-format";
import type { OperatorMonitoringData } from "@/lib/types/operator";
import type { WorkerMonitoringData } from "@/lib/types/worker-settings";
import { FailedAlerts } from "./FailedAlerts";
import { HealthyIntegrations } from "./HealthyIntegrations";
import { IntegrationIssues } from "./IntegrationIssues";
import { OverviewStats } from "./OverviewStats";

interface OverviewViewProps {
  data: OperatorMonitoringData;
  worker: WorkerMonitoringData;
}

/**
 * Platform-admin overview (roadmap 7.5, N3.9): the "anything on fire across
 * every tenant?" page. Spans every organization on the deployment rather than
 * the signed-in user's own. Failed webhooks and syncs surface as unhealthy
 * `Integration` rows (grouped by tenant, so one outage is one problem), failed
 * alert deliveries as `NotificationFailure` rows, each labelled with the
 * organization it belongs to. Only reachable by `PLATFORM_ADMIN_EMAILS`.
 */
export function OverviewView({ data, worker }: OverviewViewProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const failingAlertCount = data.failedAlerts.length + data.failedAlertsOverflowCount;
  const organizationsWithIssues = new Set([
    ...data.unhealthyIntegrations.map((row) => row.organizationId),
    ...data.failedAlerts.map((row) => row.organizationId),
  ]).size;
  const pausedCount = data.unhealthyIntegrations.filter((row) => row.pollingPausedAt).length;
  const actionableCount = data.unhealthyIntegrations.length - pausedCount;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={<MonoLabel>Platform admin / Overview</MonoLabel>}
        title="Platform overview"
        description="Failed integrations and alert deliveries across every organization on this deployment, not just your own."
        aside={
          <div className="bg-card border-border flex items-center justify-between gap-4 rounded-lg border px-4 py-2.5">
            <div className="flex flex-col gap-0.5">
              <MonoLabel>Snapshot</MonoLabel>
              <span className="text-foreground font-mono text-xs tabular-nums">{formatUtcTimestamp(data.asOf)}</span>
            </div>
            <Button type="button" variant="surface" size="sm" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} className="font-mono text-xs">
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
              Refresh
            </Button>
          </div>
        }
      />

      <OverviewStats
        data={data}
        worker={worker}
        organizationsWithIssues={organizationsWithIssues}
        failingAlertCount={failingAlertCount}
      />

      <section aria-labelledby="integration-issues" className="flex flex-col gap-3">
        <SectionTitle
          tone={actionableCount > 0 ? "danger" : "success"}
          title={<span id="integration-issues">Integrations requiring attention</span>}
          description="Re-auth needed, provider access lost, a failing streak, or data gone stale, on any organization."
          badges={
            <>
              {actionableCount > 0 && <CountBadge count={actionableCount}>actionable</CountBadge>}
              {pausedCount > 0 && (
                <CountBadge count={pausedCount} tone="warning">
                  paused
                </CountBadge>
              )}
            </>
          }
        />
        {data.unhealthyIntegrations.length === 0 ? (
          <ZeroState title="Zero ingress deficits">
            Every integration on all {data.organizationCount} organization{data.organizationCount === 1 ? "" : "s"} is syncing cleanly.
          </ZeroState>
        ) : (
          <IntegrationIssues rows={data.unhealthyIntegrations} />
        )}
      </section>

      <section aria-labelledby="failed-alerts" className="flex flex-col gap-3">
        <SectionTitle
          tone={failingAlertCount > 0 ? "danger" : "success"}
          title={<span id="failed-alerts">Failed alert deliveries</span>}
          description="Every configured channel failed at least once for these alerts."
          badges={failingAlertCount > 0 && <CountBadge count={failingAlertCount}>failing</CountBadge>}
        />
        {data.failedAlerts.length === 0 ? (
          <ZeroState title="No failed deliveries">No alert deliveries are currently failing.</ZeroState>
        ) : (
          <FailedAlerts rows={data.failedAlerts} overflowCount={data.failedAlertsOverflowCount} />
        )}
      </section>

      <HealthyIntegrations rows={data.healthyIntegrations} total={data.healthyIntegrationCount} />

      <AuditNotice label="Audit rule" tone="primary">
        Every operator inspection and change is recorded in the platform{" "}
        <Link href="/admin/audit" className="text-primary underline underline-offset-2">
          audit log
        </Link>
        .
      </AuditNotice>
    </div>
  );
}
