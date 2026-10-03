"use client";

import { Reveal } from "@/components/shared/reveal";
import type {
  DashboardData,
  DashboardSourceStatus,
} from "@/lib/types/dashboard";
import { AtRiskRightNowCard } from "./AtRiskRightNowCard";
import { AttributionLedgerCard } from "./AttributionLedgerCard";
import { BlindSpotsPanel } from "./BlindSpotsPanel";
import { CycleTimeAnomaliesBanner, NoTrackerBanner } from "./DashboardBanners";
import { DashboardKpis } from "./DashboardKpis";
import { DashboardStatusBar } from "./DashboardStatusBar";
import { LinkCoveragePanel } from "./LinkCoveragePanel";
import { SlaHealthByKindCard } from "./SlaHealthByKindCard";
import { BreachesByStageChart } from "./analytics/BreachesByStageChart";
import { BreachesOverTimeChart } from "./analytics/BreachesOverTimeChart";
import { SlaComplianceTrendChart } from "./analytics/SlaComplianceTrendChart";

interface DashboardViewProps {
  data: DashboardData;
  autoSyncSeconds: number;
  sourceStatus: DashboardSourceStatus;
}

/**
 * Reconstruction of `apps/web/stitch_elapsed/elapsed_dashboard/`: this
 * screen is rebuilt against that mockup's DOM/composition (shell +
 * operational status bar + anomaly banner + 3 KPI tiles + one 12-col chart
 * row + At-Risk snapshot + Attribution Ledger), not restyled from the
 * pre-existing generic dashboard layout — see
 * `implementation-plans/Elapsed-Redesign-Reconstruction-Audit.md`. Every
 * number here is real, derived from `getDashboardData`; fields the current
 * data model genuinely can't back yet (Jira queue/assignee, a compliance
 * target, write-back actions) render an explicit "not available" state
 * instead of a fabricated one. The mockup's "Aging in Engineering" tile and
 * queue card are dropped (performance-plan.md Phase 2 item 2): there's no
 * persisted per-case leg-time to bound them with, and evaluating every open
 * case's leg spans live to render them isn't a snapshot read.
 */
export const DashboardView = ({
  data,
  autoSyncSeconds,
  sourceStatus,
}: DashboardViewProps) => {
  return (
    <div className="mx-auto flex w-full max-w-430 flex-col gap-6">
      {/* Operational status bar */}
      <Reveal delay={0}>
        <DashboardStatusBar
          organizationName={data.organizationName}
          periodDays={data.periodDays}
          autoSyncSeconds={autoSyncSeconds}
          sourceStatus={sourceStatus}
        />
      </Reveal>

      {!data.engineeringMeasured && (
        <Reveal delay={0.02}>
          <NoTrackerBanner />
        </Reveal>
      )}

      {data.cycleTimeAnomalies.length > 0 && (
        <CycleTimeAnomaliesBanner anomalies={data.cycleTimeAnomalies} />
      )}

      {/* 3 KPI tiles */}
      <DashboardKpis data={data} />

      {/* Charts */}
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

      {/* At Risk Right Now */}
      <Reveal delay={0.24}>
        <AtRiskRightNowCard
          rows={data.atRisk}
          overflowCount={data.atRiskOverflowCount}
          engineeringMeasured={data.engineeringMeasured}
        />
      </Reveal>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Reveal delay={0.22} className="xl:col-span-6 c">
          <SlaHealthByKindCard rows={data.healthByKind} />
        </Reveal>
        {/* Attribution Ledger — was one half of a 12-col grid alongside the
          Aging Queue card; full-width on its own now that card is gone. */}
        <Reveal delay={0.27} className="xl:col-span-6">
          <AttributionLedgerCard
            ledger={data.attributionLedger}
            engineeringMeasured={data.engineeringMeasured}
          />
        </Reveal>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {data.engineeringMeasured && (
          <Reveal delay={0.23}>
            <LinkCoveragePanel coverage={data.linkCoverage} />
          </Reveal>
        )}
        <Reveal delay={0.23}>
          <BlindSpotsPanel
            unmatchedCases={data.unmatchedCases}
            unmatchedOverflowCount={data.unmatchedOverflowCount}
            integrationHealth={data.integrationHealth}
            failedAlerts={data.failedAlerts}
            failedAlertsOverflowCount={data.failedAlertsOverflowCount}
          />
        </Reveal>
      </div>
    </div>
  );
};
