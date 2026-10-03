import { Clock, Server, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatLongDateTime } from "@/lib/format";
import type { IntegrationDetailData } from "@/lib/types/integrations";
import { labelClass, Stat } from "./detail-primitives";

/** Target, connection date and ingestion mode, then the sync-health stat grid. */
export function ConnectionSummaryCard({
  data,
  label,
}: {
  data: IntegrationDetailData;
  label: string;
}) {
  const {
    provider,
    connectedAt,
    lastSyncAt,
    lastSyncError,
    lastSuccessfulSyncAt,
    consecutiveFailures,
    failingSince,
    lastSyncDurationMs,
    backfillCompletedAt,
    webhookSecret,
    webhooks: hasWebhook,
    subdomain,
    repo,
  } = data;

  const target =
    provider === "zendesk" && subdomain
      ? `${subdomain}.zendesk.com`
      : provider === "github" && repo
        ? repo
        : `${label} workspace`;

  return (
    <Card className="bg-surface-container-low flex flex-col gap-4 rounded-xl border-0 p-6 shadow-md">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className={labelClass}>
            {provider === "github" ? "Repository" : "Target"}
          </span>
          <span className="text-on-surface flex items-center gap-2 font-mono text-sm">
            <Server className="size-4 shrink-0 text-primary" />
            <span className="truncate">{target}</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={labelClass}>Connection established</span>
          <span className="text-on-surface flex items-center gap-2 font-mono text-sm">
            <Clock className="size-4 shrink-0 text-on-surface-variant" />
            {formatLongDateTime(connectedAt)}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={labelClass}>Ingestion mode</span>
          <span className="flex items-center gap-2 font-mono text-sm text-tertiary">
            <ShieldCheck className="size-4 shrink-0" />
            Strict read-only
            <span className="text-xs text-on-surface-variant">
              (zero write tokens)
            </span>
          </span>
        </div>
      </div>

      <div className="bg-surface-container grid grid-cols-2 gap-4 rounded-lg p-4 lg:grid-cols-4">
        <Stat
          label="Last sync"
          value={lastSyncAt ? formatLongDateTime(lastSyncAt) : "Never"}
        />
        <Stat
          label="Last sync result"
          value={!lastSyncAt ? "—" : lastSyncError ? "Failed" : "Succeeded"}
          tone={!lastSyncAt ? undefined : lastSyncError ? "warning" : "success"}
        />
        <Stat
          label="Last successful sync"
          value={
            lastSuccessfulSyncAt
              ? formatLongDateTime(lastSuccessfulSyncAt)
              : "Never"
          }
        />
        <Stat
          label="Failing since"
          value={failingSince ? formatLongDateTime(failingSince) : "—"}
          tone={failingSince ? "warning" : undefined}
        />
        <Stat
          label="Consecutive failures"
          value={String(consecutiveFailures)}
          tone={consecutiveFailures ? "warning" : undefined}
        />
        <Stat
          label="Latest sync duration"
          value={lastSyncDurationMs === null ? "—" : `${lastSyncDurationMs} ms`}
        />
        <Stat
          label="90-day backfill"
          value={backfillCompletedAt ? "Completed" : "Not run"}
          tone={backfillCompletedAt ? "success" : undefined}
        />
        <Stat
          label="Webhook"
          value={
            !hasWebhook
              ? "Polling only"
              : webhookSecret
                ? "Configured"
                : "Unavailable"
          }
          tone={hasWebhook && webhookSecret ? "success" : undefined}
        />
      </div>
    </Card>
  );
}
