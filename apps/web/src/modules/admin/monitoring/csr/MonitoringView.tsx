"use client";

import { Activity, Gauge, Radio, RefreshCw, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { AdminPanel, AuditNotice, Fact, MonoLabel, PageHeader, SectionTitle, StatTile, StatusDot, TONE_TEXT } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { formatUtcTimestamp } from "@/lib/admin-format";
import { formatIntervalMs } from "@/lib/format";
import { getServerSseTransportSnapshot, getSseTransportOpen, subscribeLiveStatus } from "@/lib/live-status-store";
import type { LiveDataStatusView, LiveListenerConnectionState } from "@/lib/types/live-data-status";
import {
  ACTIVE_POLL_OPTIONS,
  RECONCILIATION_OPTIONS,
  type WorkerMonitoringData,
  type WorkerStatus,
} from "@/lib/types/worker-settings";
import { IntervalSettingRow } from "./IntervalSettingRow";

const STATUS_LABEL: Record<WorkerStatus, string> = { running: "Running", degraded: "Degraded", stopped: "Stopped" };
const STATUS_TONE: Record<WorkerStatus, "success" | "warning" | "danger"> = { running: "success", degraded: "warning", stopped: "danger" };

const LIVE_STATE_LABEL: Record<LiveListenerConnectionState, string> = { connected: "Live", reconnecting: "Reconnecting", offline: "Offline" };
const LIVE_STATE_TONE: Record<LiveListenerConnectionState, "success" | "warning" | "danger"> = {
  connected: "success",
  reconnecting: "warning",
  offline: "danger",
};

interface MonitoringViewProps {
  data: WorkerMonitoringData;
  liveData: LiveDataStatusView;
}

/**
 * Worker Monitoring: the active-set poll and reconciliation sweep intervals
 * that drive `apps/worker`'s two-speed scheduler, plus its observed run
 * status. The intervals are global, not per-organization: every worker process
 * applies these same two to every organization on the platform (each
 * organization's own next-due times live in `OrganizationWorkState`; see
 * `@sla/db`'s `WorkerSettings` doc comment). Only reachable by platform
 * operators (`PLATFORM_ADMIN_EMAILS`); changing an interval is audited.
 */
export function MonitoringView({ data, liveData }: MonitoringViewProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [settings, setSettings] = useState(data);
  // This tab's own SSE transport, independent of `liveData.state` (the
  // server's Postgres-listener state, refreshed only via "Refresh" below):
  // read live from `live-status-store`, the same store the tenant app's header
  // badge reads, so it reflects reality even between refreshes.
  const sseOpen = useSyncExternalStore(subscribeLiveStatus, getSseTransportOpen, getServerSseTransportSnapshot);

  useEffect(() => {
    setSettings(data);
  }, [data]);

  async function saveActivePoll(activePollIntervalMs: number) {
    const { ok, body } = await AdminClientActions.saveWorkerSettings({
      activePollIntervalMs,
      reconciliationIntervalMs: settings.reconciliationIntervalMs,
    });
    if (ok) {
      setSettings(body);
      router.refresh();
      return { ok: true as const };
    }
    return { ok: false as const, error: body.error };
  }

  async function saveReconciliation(reconciliationIntervalMs: number) {
    const { ok, body } = await AdminClientActions.saveWorkerSettings({
      activePollIntervalMs: settings.activePollIntervalMs,
      reconciliationIntervalMs,
    });
    if (ok) {
      setSettings(body);
      router.refresh();
      return { ok: true as const };
    }
    return { ok: false as const, error: body.error };
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={<MonoLabel>Platform administration / Infrastructure / Workers &amp; cadence</MonoLabel>}
        title="Monitoring & worker controls"
        description="How often the worker checks SLA commitments, and whether it and the live-data pipe are healthy. Separate from the nightly integrity check."
        aside={
          <Button type="button" variant="surface" size="sm" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} className="font-mono text-xs">
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            Refresh status
          </Button>
        }
      />

      <AuditNotice label="Audited operational parameter">
        {settings.canEdit ? "Changing a worker interval applies on the worker's next tick, with no restart, and records " : "These intervals are view only here. A change would be recorded as "}
        <code className="text-primary font-mono font-bold">update_worker_settings</code> in the audit log.
      </AuditNotice>

      <section aria-label="Worker summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Worker"
          icon={Activity}
          value={
            <span className={`flex items-center gap-2 text-2xl ${TONE_TEXT[STATUS_TONE[settings.status]]}`}>
              <StatusDot tone={STATUS_TONE[settings.status]} pulse={settings.status === "running"} className="size-2.5" />
              {STATUS_LABEL[settings.status]}
            </span>
          }
          detail="Reported by the worker process itself, not this page."
        />
        <StatTile label="Active polling" icon={Timer} value={formatIntervalMs(settings.activePollIntervalMs)} detail="Cases with live SLA commitments." />
        <StatTile label="Reconciliation" icon={Gauge} value={formatIntervalMs(settings.reconciliationIntervalMs)} detail="Catches missed updates in recent changes." />
        <StatTile
          label="Live data listener"
          icon={Radio}
          value={
            <span className={`flex items-center gap-2 text-2xl ${TONE_TEXT[LIVE_STATE_TONE[liveData.state]]}`}>
              <StatusDot tone={LIVE_STATE_TONE[liveData.state]} pulse={liveData.state === "connected"} className="size-2.5" />
              {LIVE_STATE_LABEL[liveData.state]}
            </span>
          }
          detail={`${liveData.reconnectCount} reconnect${liveData.reconnectCount === 1 ? "" : "s"} since start.`}
        />
      </section>

      <section aria-labelledby="cadence" className="flex flex-col gap-3">
        <SectionTitle
          icon={Timer}
          title={<span id="cadence">Worker cycle cadence</span>}
          description="These timers are global: every organization on the platform follows them. A shorter active interval means faster warnings and more provider API calls; a longer one means the reverse."
        />
        <div className="grid gap-3 xl:grid-cols-2">
          <IntervalSettingRow
            label="Active monitoring"
            description="Checks active cases with live SLA commitments."
            badge="Hot path"
            valueMs={settings.activePollIntervalMs}
            lastCycleAt={settings.lastActivePollAt}
            nextCycleAt={settings.nextActivePollAt}
            options={ACTIVE_POLL_OPTIONS}
            canEdit={settings.canEdit}
            onSave={saveActivePoll}
          />
          <IntervalSettingRow
            label="Reconciliation"
            description="Periodically verifies recent changes and catches missed updates."
            badge="Deep audit"
            valueMs={settings.reconciliationIntervalMs}
            lastCycleAt={settings.lastReconciliationAt}
            nextCycleAt={settings.nextReconciliationAt}
            options={RECONCILIATION_OPTIONS}
            canEdit={settings.canEdit}
            onSave={saveReconciliation}
          />
        </div>
      </section>

      <section aria-labelledby="live-data" className="flex flex-col gap-3">
        <SectionTitle
          icon={Radio}
          title={<span id="live-data">Live data</span>}
          description="Postgres LISTEN/NOTIFY → this web process → SSE → a browser. Reported by this process itself; the SSE row is this browser tab's own view."
        />
        <AdminPanel className="p-4">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Live data listener">
              <span className={`inline-flex items-center gap-1.5 font-semibold ${TONE_TEXT[LIVE_STATE_TONE[liveData.state]]}`}>
                <StatusDot tone={LIVE_STATE_TONE[liveData.state]} />
                {LIVE_STATE_LABEL[liveData.state]}
              </span>
            </Fact>
            <Fact label="SSE connection (this tab)">
              <span className={`inline-flex items-center gap-1.5 font-semibold ${sseOpen ? TONE_TEXT.success : TONE_TEXT.warning}`}>
                <StatusDot tone={sseOpen ? "success" : "warning"} />
                {sseOpen ? "Connected" : "Reconnecting"}
              </span>
            </Fact>
            <Fact label="Reconnects" mono>
              {liveData.reconnectCount}
            </Fact>
            <Fact label="Last connected" mono>
              {formatUtcTimestamp(liveData.lastConnectedAt)}
            </Fact>
            <Fact label="Last event received" mono>
              {formatUtcTimestamp(liveData.lastEventAt)}
            </Fact>
            <Fact label="Last error" mono tone={liveData.lastErrorMessage ? "danger" : undefined}>
              {liveData.lastErrorMessage ? `${liveData.lastErrorMessage} (${formatUtcTimestamp(liveData.lastErrorAt)})` : "None"}
            </Fact>
          </dl>
        </AdminPanel>
      </section>
    </div>
  );
}
