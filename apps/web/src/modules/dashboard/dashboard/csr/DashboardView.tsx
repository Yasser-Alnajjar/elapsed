"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  AlarmClockOff,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Download,
  Gauge,
  Hourglass,
  Network,
  RefreshCw,
  X,
  Activity,
} from "lucide-react";
import { Reveal } from "@/components/shared/reveal";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCommitmentKind, formatMinutes } from "@/lib/format";
import type { DashboardData } from "@/lib/types/dashboard";
import { AgingQueueList } from "./AgingQueueList";
import { AtRiskSnapshotTable } from "./AtRiskSnapshotTable";
import { AttributionLedgerCard } from "./AttributionLedgerCard";
import { BlindSpotsPanel } from "./BlindSpotsPanel";
import { KpiTile } from "./KpiTile";
import { SlaHealthByKindCard } from "./SlaHealthByKindCard";
import { BreachesByStageChart } from "./analytics/BreachesByStageChart";
import { BreachesOverTimeChart } from "./analytics/BreachesOverTimeChart";
import { SlaComplianceTrendChart } from "./analytics/SlaComplianceTrendChart";
import Link from "next/link";

interface DashboardViewProps {
  data: DashboardData;
  autoSyncSeconds: number;
  sourceStatus: { zendesk: boolean; jira: boolean };
}

/**
 * Reconstruction of `apps/web/stitch_elapsed/elapsed_dashboard/`: this
 * screen is rebuilt against that mockup's DOM/composition (shell +
 * operational status bar + anomaly banner + 4 KPI tiles + one 12-col chart
 * row + At-Risk snapshot + Aging Queue + Attribution Ledger), not
 * restyled from the pre-existing generic dashboard layout — see
 * `implementation-plans/Elapsed-Redesign-Reconstruction-Audit.md`. Every
 * number here is real, derived from `getDashboardData`; fields the current
 * data model genuinely can't back yet (Jira queue/assignee, a compliance
 * target, write-back actions) render an explicit "not available" state
 * instead of a fabricated one.
 */
export const DashboardView = ({
  data,
  autoSyncSeconds,
  sourceStatus,
}: DashboardViewProps) => {
  const router = useRouter();
  const [engineeringBannerDismissed, setEngineeringBannerDismissed] =
    useState(false);
  const [cycleBannerDismissed, setCycleBannerDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const complianceTrend =
    data.compliance.current !== null && data.compliance.previous !== null
      ? data.compliance.current - data.compliance.previous
      : null;

  const breachedByKind = data.breachedThisPeriod.reduce<
    Partial<Record<(typeof data.breachedThisPeriod)[number]["kind"], number>>
  >((acc, row) => {
    acc[row.kind] = (acc[row.kind] ?? 0) + 1;
    return acc;
  }, {});

  const breachTrend =
    data.breachedPreviousPeriodCount !== null
      ? data.breachedThisPeriod.length - data.breachedPreviousPeriodCount
      : null;

  const handleRefresh = () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <div className="mx-auto flex w-full max-w-430 flex-col gap-6">
      {/* Operational status bar */}
      <Reveal delay={0}>
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-outline font-mono text-xxs font-semibold uppercase tracking-wider">
                Deterministic Attribution
              </span>
              {data.organizationName && (
                <>
                  <span className="text-outline-variant">•</span>
                  <span className="text-primary font-mono text-xxs uppercase">
                    {data.organizationName}
                  </span>
                </>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-on-surface text-2xl font-semibold tracking-tight">
                Elapsed Operations Ledger
              </span>
              <span className="bg-surface-container-high text-on-surface-variant rounded px-2 py-0.5 font-mono text-xs">
                Fixed {data.periodDays}-Day Analysis Window
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-outline">Read-only sync active:</span>
              <span
                className={
                  sourceStatus.zendesk
                    ? "text-tertiary font-mono text-xs"
                    : "text-outline font-mono text-xs"
                }
              >
                Zendesk ({sourceStatus.zendesk ? "Connected" : "Not connected"})
              </span>
              <span className="text-outline-variant text-xxs">•</span>
              <span
                className={
                  sourceStatus.jira
                    ? "text-primary font-mono text-xs"
                    : "text-outline font-mono text-xs"
                }
              >
                Jira ({sourceStatus.jira ? "Connected" : "Not connected"})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start lg:self-auto flex-wrap">
            <a
              href="/api/reports/commitments"
              download
              className="cursor-pointer bg-surface-container hover:bg-surface-container-high text-on-surface shadow-soft flex items-center gap-2 rounded px-3.5 py-2 text-xs md:text-sm transition-colors"
            >
              <Download className="text-primary size-4" />
              Export Full CSV ({data.periodDays} Days)
            </a>
            <button
              type="button"
              onClick={handleRefresh}
              className="cursor-pointer bg-surface-container-high hover:bg-surface-active text-on-surface shadow-soft flex items-center gap-2 rounded px-3.5 py-2 text-xs md:text-sm transition-colors"
            >
              <RefreshCw
                className={`text-tertiary size-4 ${refreshing ? "animate-spin" : ""}`}
              />
              <span className="font-mono text-xs uppercase">
                Auto-Sync: {autoSyncSeconds}s
              </span>
            </button>
          </div>
        </div>
      </Reveal>

      {/* Anomaly banner: cases in engineering over the configured target */}
      {data.engineeringOverTargetCount !== null &&
        data.engineeringOverTargetCount > 0 &&
        !engineeringBannerDismissed && (
          <Reveal delay={0.02}>
            <div className="bg-surface-container-low shadow-soft relative overflow-hidden rounded-xl p-4">
              <div
                className="bg-warning absolute inset-y-0 left-0 w-1.5"
                aria-hidden
              />
              <div className="flex flex-col items-start justify-between gap-3 pl-2 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3 sm:items-center">
                  <span className="bg-surface-container-highest flex size-8 shrink-0 items-center justify-center rounded">
                    <AlertTriangle className="text-warning size-5" />
                  </span>
                  <div>
                    <p className="text-warning font-mono text-xxs font-semibold uppercase tracking-wider">
                      Engineering leg over target
                    </p>
                    <p className="text-on-surface mt-0.5 text-sm">
                      <strong className="font-medium">
                        {data.engineeringOverTargetCount} case
                        {data.engineeringOverTargetCount !== 1 ? "s" : ""}
                      </strong>{" "}
                      currently in engineering have exceeded the configured
                      target resolution window. SLA clock is running.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 pl-11 sm:pl-0">
                  <a
                    href="#at-risk-table"
                    className="text-primary hover:bg-surface-container flex items-center gap-1 rounded px-2 py-1 text-sm"
                  >
                    View at-risk cases
                    <ArrowRight className="size-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setEngineeringBannerDismissed(true)}
                    className="text-outline hover:text-on-surface p-1 transition-colors"
                    aria-label="Dismiss"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        )}

      {data.cycleTimeAnomalies.length > 0 && !cycleBannerDismissed && (
        <Reveal delay={0.03}>
          <div className="bg-surface-container-low shadow-soft relative overflow-hidden rounded-xl p-4">
            <div
              className="bg-warning absolute inset-y-0 left-0 w-1.5"
              aria-hidden
            />
            <div className="flex flex-col gap-3 pl-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="bg-surface-container-highest flex size-8 shrink-0 items-center justify-center rounded">
                  <AlertTriangle className="text-warning size-4" />
                </span>
                <div>
                  <p className="text-warning font-mono text-xxs font-semibold uppercase tracking-wider">
                    Unusual cycle times
                  </p>
                  <ul className="text-outline mt-1.5 space-y-1 text-sm">
                    {data.cycleTimeAnomalies.map((row, i) => (
                      <li key={i}>
                        <span className="text-on-surface font-medium">
                          {row.customerName}
                        </span>{" "}
                        · {formatCommitmentKind(row.kind)} is running{" "}
                        <span className="text-on-surface font-medium">
                          {row.direction}
                        </span>{" "}
                        than usual: recent median{" "}
                        {formatMinutes(row.recentMedianMinutes)} vs. baseline{" "}
                        {formatMinutes(row.baselineMedianMinutes)} (
                        {row.recentCount} recent of {row.baselineCount}{" "}
                        historical cases).
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCycleBannerDismissed(true)}
                className="text-outline hover:text-on-surface shrink-0 p-1.5 transition-colors"
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </Reveal>
      )}

      {/* 4 KPI tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Reveal delay={0.05}>
          <KpiTile
            label="Breached Cases"
            icon={AlarmClockOff}
            value={data.breachedThisPeriod.length}
            cornerFrom="from-error/15"
            qualifier={
              breachTrend !== null && (
                <span
                  className={`flex items-center font-mono text-xs ${breachTrend > 0 ? "text-error" : breachTrend < 0 ? "text-tertiary" : "text-outline"}`}
                >
                  {breachTrend > 0 ? (
                    <ArrowUp className="size-3.5" />
                  ) : breachTrend < 0 ? (
                    <ArrowDown className="size-3.5" />
                  ) : null}
                  {Math.abs(breachTrend)} vs prior {data.periodDays}d
                </span>
              )
            }
            footer={
              Object.keys(breachedByKind).length === 0 ? (
                <span className="text-outline">No breaches this period</span>
              ) : (
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  {Object.entries(breachedByKind).map(([kind, count]) => (
                    <span
                      key={kind}
                      className="text-on-surface-variant flex items-center gap-1.5"
                    >
                      <span className="bg-outline size-1.5 rounded-full" />
                      {count} {formatCommitmentKind(kind as never)}
                    </span>
                  ))}
                </div>
              )
            }
          />
        </Reveal>

        <Reveal delay={0.08}>
          <KpiTile
            label="SLA Compliance Rate"
            cornerFrom="from-primary/15"
            icon={Activity}
            value={
              data.compliance.current === null
                ? "—"
                : `${data.compliance.current}%`
            }
            valueClassName={
              data.compliance.current !== null && data.compliance.current < 95
                ? "text-warning"
                : undefined
            }
            qualifier={
              complianceTrend !== null && (
                <span className="text-outline font-mono text-xs">
                  {complianceTrend >= 0 ? "+" : ""}
                  {Math.round(complianceTrend * 10) / 10}pp vs prior period
                </span>
              )
            }
            footer={
              <div className="flex w-full flex-col gap-1">
                <div className="bg-surface-container-highest h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-warning h-full rounded-full"
                    style={{ width: `${data.compliance.current ?? 0}%` }}
                  />
                </div>
                <span className="text-outline truncate text-xxs">
                  No compliance target configured
                </span>
              </div>
            }
          />
        </Reveal>

        <Reveal delay={0.11}>
          <KpiTile
            label="Aging in Engineering"
            icon={Hourglass}
            cornerFrom="from-tertiary/10"
            value={data.agingInEngineering.length}
            qualifier={<span className="text-outline text-base">cases</span>}
            footer={
              <>
                <span className="text-outline">Avg wait to eng. pickup:</span>
                <span className="text-primary font-mono text-xs font-semibold">
                  {data.avgQueueWaitMinutes !== null
                    ? formatMinutes(data.avgQueueWaitMinutes)
                    : "—"}
                </span>
              </>
            }
          />
        </Reveal>

        <Reveal delay={0.14}>
          <KpiTile
            label="Total Escalated"
            icon={Network}
            cornerFrom="from-secondary/20"
            value={data.totalEscalated.count}
            qualifier={
              <span className="text-outline text-base">cross-team</span>
            }
            footer={
              <div className="flex w-full items-center justify-between">
                <span className="text-tertiary flex items-center gap-1.5">
                  <span className="bg-tertiary size-2 rounded-full" />
                  {data.totalEscalated.linkedCertain} Linked — Certain
                </span>
                <span className="text-outline flex items-center gap-1.5">
                  <span className="bg-outline size-1.5 rounded-full" />
                  {data.totalEscalated.unlinkedOrOther} Unlinked
                </span>
              </div>
            }
          />
        </Reveal>
      </div>

      {/* Chart row: 5 / 4 / 3 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Reveal delay={0.17} className="lg:col-span-5">
          <BreachesOverTimeChart
            data={data.analytics.breachesOverTimeByLeg}
            periodDays={data.periodDays}
          />
        </Reveal>
        <Reveal delay={0.19} className="lg:col-span-4">
          <SlaComplianceTrendChart
            data={data.analytics.complianceTrend}
            currentCompliance={data.compliance.current}
          />
        </Reveal>
        <Reveal delay={0.21} className="lg:col-span-3">
          <BreachesByStageChart data={data.analytics.breachesByStage} />
        </Reveal>
      </div>

      {/* SLA Health by Kind + Blind Spots (Phase 6) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Reveal delay={0.22} className="xl:col-span-5">
          <SlaHealthByKindCard rows={data.healthByKind} />
        </Reveal>
        <Reveal delay={0.23} className="xl:col-span-7">
          <BlindSpotsPanel
            unmatchedCases={data.unmatchedCases}
            unmatchedOverflowCount={data.unmatchedOverflowCount}
            integrationHealth={data.integrationHealth}
            failedAlerts={data.failedAlerts}
            failedAlertsOverflowCount={data.failedAlertsOverflowCount}
          />
        </Reveal>
      </div>

      {/* At Risk Right Now */}
      <Reveal delay={0.24}>
        <div
          id="at-risk-table"
          className="bg-surface-container-low shadow-soft scroll-mt-20 overflow-hidden rounded-xl"
        >
          <div className="bg-surface-container/60 border-surface-container-highest/60 flex flex-col items-start justify-between gap-2 border-b p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <span className="bg-warning size-3 animate-ping rounded-full shrink-0" />
              <div>
                <h2 className="text-on-surface text-base font-medium">
                  At Risk Right Now
                </h2>
                <p className="text-outline text-sm">
                  Cases projected to breach within 2.5 hours under current
                  allocation trajectory
                </p>
              </div>
            </div>
            <span className="bg-warning/15 text-warning rounded px-2.5 py-1 font-mono text-xs font-medium">
              {data.atRisk.length} Active Escalation
              {data.atRisk.length !== 1 ? "s" : ""}
            </span>
          </div>
          {data.atRisk.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Gauge}
                title="Nothing at risk right now"
                description="No open commitments are projected to breach soon."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <AtRiskSnapshotTable rows={data.atRisk} />
            </div>
          )}
          {data.atRiskOverflowCount > 0 && (
            <p className="border-border-subtle bg-surface-subtle text-muted-foreground border-t px-4 py-2.5 text-xs">
              +{data.atRiskOverflowCount} more open commitment(s) not shown —{" "}
              <Link href="/cases" className="text-primary hover:underline">
                see full case list
              </Link>
              .
            </p>
          )}
        </div>
      </Reveal>

      {/* Aging Queue + Attribution Ledger */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Reveal delay={0.27} className="xl:col-span-8">
          <div className="bg-surface-container-low shadow-soft flex flex-col overflow-hidden rounded-xl">
            <div className="bg-surface-container/60 border-surface-container-highest/60 flex items-center justify-between border-b p-4 flex-wrap">
              <div>
                <h3 className="text-on-surface text-base font-medium">
                  Aging in Engineering Queue
                </h3>
                <p className="text-outline text-sm">
                  Cases spending longest continuous time in engineering status
                </p>
              </div>
              <span className="text-primary bg-primary/10 rounded px-2 py-1 font-mono text-xs">
                Top {data.agingInEngineering.length} longest leg hold
              </span>
            </div>
            {data.agingInEngineering.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Hourglass}
                  title="Nothing aging in engineering"
                  description="No case is currently sitting in the engineering leg."
                />
              </div>
            ) : (
              <AgingQueueList rows={data.agingInEngineering} />
            )}
            {data.agingOverflowCount > 0 && (
              <p className="border-border-subtle bg-surface-subtle text-muted-foreground border-t px-4 py-2.5 text-xs">
                +{data.agingOverflowCount} more.
              </p>
            )}
          </div>
        </Reveal>

        <Reveal delay={0.3} className="xl:col-span-4">
          <AttributionLedgerCard ledger={data.attributionLedger} />
        </Reveal>
      </div>
    </div>
  );
};
