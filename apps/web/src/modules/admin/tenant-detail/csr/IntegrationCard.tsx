import {
  CheckCircle2,
  GitBranch,
  LifeBuoy,
  RefreshCw,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Fact, Tag, TONE_SURFACE } from "@/components/admin/admin-ui";
import { integrationState } from "@/components/admin/tenant-badges";
import { formatSpan, formatUtcTimestamp } from "@/lib/admin-format";
import type { AdminIntegrationDetailRow } from "@/lib/types/admin";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import { cn } from "@/lib/utils";
import { IntegrationControls } from "./IntegrationControls";

const ROLE_ICON: Record<AdminIntegrationDetailRow["role"], LucideIcon> = {
  ticket_source: LifeBuoy,
  work_tracker: GitBranch,
  code_host: GitBranch,
};

/**
 * One integration of the tenant: its state, the numbers behind it, the
 * provider's last error, and the operator controls. Never shows a credential;
 * the error text is the provider's own response.
 */
export function IntegrationCard({
  integration,
  tenantName,
}: {
  integration: AdminIntegrationDetailRow;
  tenantName: string;
}) {
  const { label, tone } = integrationState(integration);
  const Icon = ROLE_ICON[integration.role];
  const failing = integration.consecutiveFailures > 0;

  return (
    <li
      className={cn(
        "bg-card overflow-hidden rounded-lg border",
        tone === "danger" ? "border-error/35" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-surface-raised border-border text-primary flex size-9 shrink-0 items-center justify-center rounded border">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-foreground text-base font-semibold">
                {INTEGRATION_PROVIDER_LABELS[integration.provider]}
              </h3>
              <Tag>{integration.role.replace("_", " ")}</Tag>
            </div>
            <p className="text-foreground-subtle font-mono text-xxs">
              Connected {formatUtcTimestamp(integration.connectedAt)}
            </p>
          </div>
        </div>
        <Tag tone={tone} className="px-2 py-1 text-xxs">
          {label}
          {tone === "danger" &&
            failing &&
            integration.status === "connected" &&
            ` · ${integration.consecutiveFailures} consecutive`}
        </Tag>
      </div>

      <dl className="bg-background/50 border-border grid gap-x-6 gap-y-3 border-y px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Last successful sync" mono>
          {formatUtcTimestamp(integration.lastSuccessfulSyncAt)}
        </Fact>
        <Fact label="Last attempt" mono>
          {formatUtcTimestamp(integration.lastSyncAt)}
          {integration.lastSyncDurationMs !== null && (
            <span className="text-foreground-subtle block text-xxs">
              took {formatSpan(integration.lastSyncDurationMs)} (
              {integration.lastSyncDurationMs} ms)
            </span>
          )}
        </Fact>
        <Fact
          label="Consecutive failures"
          mono
          tone={failing ? "danger" : undefined}
        >
          {integration.consecutiveFailures}
        </Fact>
        <Fact
          label="Failing since"
          mono
          tone={integration.failingSince ? "danger" : undefined}
        >
          {integration.failingSince
            ? formatUtcTimestamp(integration.failingSince)
            : "—"}
        </Fact>
        <Fact label="Backfill" mono>
          {integration.backfillCompletedAt ? (
            <span className="text-success inline-flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Completed {formatUtcTimestamp(integration.backfillCompletedAt)}
            </span>
          ) : (
            "Not completed"
          )}
        </Fact>
        {integration.pollingPausedAt && (
          <Fact label="Polling paused since" mono tone="warning">
            {formatUtcTimestamp(integration.pollingPausedAt)}
          </Fact>
        )}
        {integration.renormalizeRequestedAt && (
          <Fact label="Re-normalization requested" mono>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="size-3.5" aria-hidden />
              {formatUtcTimestamp(integration.renormalizeRequestedAt)}
            </span>
          </Fact>
        )}
      </dl>

      {(integration.lastSyncError ||
        (integration.stale &&
          integration.staleSince &&
          !integration.pollingPausedAt)) && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          {integration.lastSyncError && (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded border px-3.5 py-2.5",
                TONE_SURFACE.danger,
              )}
            >
              <Terminal className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <span className="font-mono text-[10px] font-semibold tracking-[0.08em] uppercase">
                  Last error
                </span>
                <p className="text-foreground mt-0.5 font-mono text-xs leading-5 break-words">
                  {integration.lastSyncError}
                </p>
              </div>
            </div>
          )}
          {integration.stale &&
            integration.staleSince &&
            !integration.pollingPausedAt && (
              <p className="text-warning-text flex items-center gap-2 font-mono text-xs">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                Stale since {formatUtcTimestamp(integration.staleSince)}.
              </p>
            )}
        </div>
      )}

      <div className="px-4 py-3">
        <IntegrationControls
          integration={integration}
          tenantName={tenantName}
        />
      </div>
    </li>
  );
}
