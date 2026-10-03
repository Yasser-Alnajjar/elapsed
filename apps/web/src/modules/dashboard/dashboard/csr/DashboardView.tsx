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
 * Every number here is real, derived from `getDashboardData`. Fields the data
 * model can't back yet (Jira queue/assignee, a compliance target, write-back
 * actions) render an explicit "not available" state rather than a fabricated
 * value.
 */
export const DashboardView = ({
  data,
  autoSyncSeconds,
  sourceStatus,
}: DashboardViewProps) => {
  return (
    <div className="mx-auto flex w-full max-w-430 flex-col gap-6">
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

      <DashboardKpis data={data} />

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

      <Reveal delay={0.24}>
        <AtRiskRightNowCard
          rows={data.atRisk}
          overflowCount={data.atRiskOverflowCount}
          engineeringMeasured={data.engineeringMeasured}
        />
      </Reveal>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Reveal delay={0.22} className="xl:col-span-6">
          <SlaHealthByKindCard rows={data.healthByKind} />
        </Reveal>
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
