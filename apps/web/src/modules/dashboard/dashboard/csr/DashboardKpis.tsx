import {
  Activity,
  AlarmClockOff,
  ArrowDown,
  ArrowUp,
  Network,
} from "lucide-react";
import { Reveal } from "@/components/shared/reveal";
import { formatCommitmentKind } from "@/lib/format";
import type { DashboardData } from "@/lib/types/dashboard";
import { KpiTile } from "./KpiTile";

function BreachedCasesTile({ data }: { data: DashboardData }) {
  const breachedByKind = data.breachedThisPeriod.byKind;
  const breachTrend =
    data.breachedPreviousPeriodCount !== null
      ? data.breachedThisPeriod.total - data.breachedPreviousPeriodCount
      : null;

  return (
    <KpiTile
      label="Breached Cases"
      icon={AlarmClockOff}
      value={data.breachedThisPeriod.total}
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
  );
}

function ComplianceTile({
  compliance,
}: {
  compliance: DashboardData["compliance"];
}) {
  const complianceTrend =
    compliance.current !== null && compliance.previous !== null
      ? compliance.current - compliance.previous
      : null;

  return (
    <KpiTile
      label="SLA Compliance Rate"
      cornerFrom="from-primary/15"
      icon={Activity}
      value={compliance.current === null ? "—" : `${compliance.current}%`}
      valueClassName={
        compliance.current !== null && compliance.current < 95
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
              style={{ width: `${compliance.current ?? 0}%` }}
            />
          </div>
          <span className="text-outline truncate text-xxs">
            No compliance target configured
          </span>
        </div>
      }
    />
  );
}

function EscalatedTile({
  escalated,
  engineeringMeasured,
}: {
  escalated: DashboardData["totalEscalated"];
  engineeringMeasured: boolean;
}) {
  return (
    <KpiTile
      label="Total Escalated"
      icon={Network}
      cornerFrom="from-secondary/20"
      value={engineeringMeasured ? escalated.count : "—"}
      qualifier={<span className="text-outline text-base">cross-team</span>}
      footer={
        engineeringMeasured ? (
          <div className="flex w-full items-center justify-between">
            <span className="text-tertiary flex items-center gap-1.5">
              <span className="bg-tertiary size-2 rounded-full" />
              {escalated.linkedCertain} Linked — Certain
            </span>
            <span className="text-outline flex items-center gap-1.5">
              <span className="bg-outline size-1.5 rounded-full" />
              {escalated.unlinkedOrOther} Unlinked
            </span>
          </div>
        ) : (
          <span className="text-outline">Needs a work tracker</span>
        )
      }
    />
  );
}

/** The three headline KPI tiles: breaches, compliance and escalations. */
export function DashboardKpis({ data }: { data: DashboardData }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Reveal delay={0.05}>
        <BreachedCasesTile data={data} />
      </Reveal>

      <Reveal delay={0.08}>
        <ComplianceTile compliance={data.compliance} />
      </Reveal>

      <Reveal delay={0.14}>
        <EscalatedTile
          escalated={data.totalEscalated}
          engineeringMeasured={data.engineeringMeasured}
        />
      </Reveal>
    </div>
  );
}
