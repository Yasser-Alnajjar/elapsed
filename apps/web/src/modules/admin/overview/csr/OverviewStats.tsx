import { Activity, Building2, PlugZap, Radio } from "lucide-react";
import Link from "next/link";
import { StatTile, StatusDot, TONE_TEXT } from "@/components/admin/admin-ui";
import { formatUtcShort } from "@/lib/admin-format";
import { formatIntervalMs } from "@/lib/format";
import type { OperatorMonitoringData } from "@/lib/types/operator";
import type { WorkerMonitoringData, WorkerStatus } from "@/lib/types/worker-settings";
import { cn } from "@/lib/utils";

const WORKER_TONE: Record<WorkerStatus, "success" | "warning" | "danger"> = {
  running: "success",
  degraded: "warning",
  stopped: "danger",
};
const WORKER_LABEL: Record<WorkerStatus, string> = { running: "Running", degraded: "Degraded", stopped: "Stopped" };

interface OverviewStatsProps {
  data: OperatorMonitoringData;
  worker: WorkerMonitoringData;
  /** Organizations with an unhealthy integration or a failing alert delivery. */
  organizationsWithIssues: number;
  failingAlertCount: number;
}

/** The four numbers that answer "is anything on fire?" before any list is read. */
export function OverviewStats({ data, worker, organizationsWithIssues, failingAlertCount }: OverviewStatsProps) {
  const unhealthyConnected = data.connectedIntegrationCount - data.healthyIntegrationCount;
  const syncingShare = data.connectedIntegrationCount === 0 ? 100 : Math.round((data.healthyIntegrationCount / data.connectedIntegrationCount) * 100);

  return (
    <section aria-label="Platform summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Organizations"
        icon={Building2}
        value={data.organizationCount}
        tone={organizationsWithIssues > 0 ? "warning" : undefined}
        detail={
          organizationsWithIssues > 0 ? (
            <span className={TONE_TEXT.warning}>
              {organizationsWithIssues} need{organizationsWithIssues === 1 ? "s" : ""} attention ·{" "}
              <Link href="/admin/tenants" className="underline underline-offset-2">
                see tenants
              </Link>
            </span>
          ) : (
            "None need attention"
          )
        }
      />

      <StatTile
        label="Syncing integrations"
        icon={PlugZap}
        value={
          <>
            {data.healthyIntegrationCount}
            <span className="text-foreground-subtle text-xl font-medium"> / {data.connectedIntegrationCount}</span>
          </>
        }
        tone={unhealthyConnected > 0 ? "warning" : "success"}
        detail={
          <div className="flex flex-col gap-1.5">
            <div className="bg-surface-hover h-1 w-full overflow-hidden rounded-full">
              <div className={cn("h-full rounded-full", unhealthyConnected > 0 ? "bg-warning" : "bg-success")} style={{ width: `${syncingShare}%` }} />
            </div>
            <span>{unhealthyConnected === 0 ? "Every connected integration is syncing." : `${unhealthyConnected} need attention.`}</span>
          </div>
        }
      />

      <StatTile
        label="Failing alert deliveries"
        icon={Radio}
        value={failingAlertCount}
        tone={failingAlertCount > 0 ? "danger" : "success"}
        detail={failingAlertCount > 0 ? "No channel could deliver these alerts." : "Every alert is being delivered."}
      />

      <StatTile
        label="Ingestion worker"
        icon={Activity}
        value={
          <span className={cn("flex items-center gap-2 text-2xl", TONE_TEXT[WORKER_TONE[worker.status]])}>
            <StatusDot tone={WORKER_TONE[worker.status]} pulse={worker.status === "running"} className="size-2.5" />
            {WORKER_LABEL[worker.status]}
          </span>
        }
        detail={
          <>
            Active cycle every {formatIntervalMs(worker.activePollIntervalMs)}
            {worker.nextActivePollAt && <> · next {formatUtcShort(worker.nextActivePollAt)} UTC</>}
          </>
        }
      />
    </section>
  );
}
