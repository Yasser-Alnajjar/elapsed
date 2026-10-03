import { AlertTriangle, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { UsageBar } from "@/components/billing/billing-ui";
import type { BillingKpis } from "@/lib/admin-billing-list";
import { formatMoney, formatMoneyCompact, formatPercent, percentOf } from "@/lib/billing-format";
import { cn } from "@/lib/utils";

function KpiCard({ label, labelClassName, aside, children, footer }: { label: string; labelClassName?: string; aside: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <AdminPanel className="relative flex flex-col justify-between gap-3 overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <MonoLabel className={labelClassName}>{label}</MonoLabel>
        {aside}
      </div>
      <div className="flex items-baseline gap-2">{children}</div>
      <div>{footer}</div>
    </AdminPanel>
  );
}

const CHIP = "bg-background/60 rounded px-1.5 py-0.5 font-mono text-[10px] leading-3 font-semibold tracking-[0.04em] uppercase whitespace-nowrap";
const VALUE = "font-mono text-3xl leading-none font-bold tracking-tight tabular-nums sm:text-4xl";

/** MRR, tenants by subscription state, overdue money, and licensed-seat utilisation across every tenant. */
export function BillingKpiStrip({ kpis, currency }: { kpis: BillingKpis; currency: string }) {
  const seatPercent = percentOf(kpis.seatsUsed, kpis.seatsLicensed);
  const segments = [
    { count: kpis.active, className: "bg-primary", label: "Active" },
    { count: kpis.trialing, className: "bg-warning", label: "Trial" },
    { count: kpis.pastDue, className: "bg-error", label: "Past due" },
    { count: kpis.other, className: "bg-foreground-subtle", label: "Cancelled, internal or no plan" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Monthly recurring rev"
        aside={
          <span className={cn(CHIP, "text-success flex items-center gap-0.5")}>
            <TrendingUp aria-hidden className="size-3" />
            {kpis.active + kpis.pastDue} paying
          </span>
        }
        footer={
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Annual run rate (ARR)</span>
            <span className="text-foreground font-mono font-bold tabular-nums">{formatMoneyCompact(kpis.arrCents, currency)}</span>
          </div>
        }
      >
        <span className={cn(VALUE, "text-foreground")}>{formatMoney(kpis.mrrCents, currency)}</span>
      </KpiCard>

      <KpiCard
        label="Subscribed tenants"
        aside={<span className={cn(CHIP, "text-primary")}>{kpis.active + kpis.trialing + kpis.pastDue} on clock</span>}
        footer={
          <div className="flex flex-col gap-2">
            <div className="bg-background flex h-2 gap-0.5 overflow-hidden rounded" role="img" aria-label={segments.map((s) => `${s.count} ${s.label}`).join(", ")}>
              {segments.map((segment) =>
                segment.count > 0 ? (
                  <div key={segment.label} title={`${segment.count} ${segment.label}`} className={cn("h-full", segment.className)} style={{ width: `${(segment.count / Math.max(1, kpis.total)) * 100}%` }} />
                ) : null,
              )}
            </div>
            <div className="text-muted-foreground flex items-center justify-between font-mono text-[10px]">
              <span>{kpis.active} Active</span>
              <span>{kpis.trialing} Trial</span>
              <span className="text-error">{kpis.pastDue} Past due</span>
            </div>
          </div>
        }
      >
        <span className={cn(VALUE, "text-foreground")}>{kpis.total}</span>
        <span className="text-foreground-subtle text-xs">total tenants</span>
      </KpiCard>

      <KpiCard
        label="Dunning & payment risk"
        labelClassName="text-warning-text"
        aside={
          <span className={cn(CHIP, kpis.attention > 0 ? "text-error" : "text-success", "flex items-center gap-1")}>
            <AlertTriangle aria-hidden className="size-3" />
            {kpis.attention} attention
          </span>
        }
        footer={
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Most overdue</span>
            <span className={cn(CHIP, "text-foreground normal-case")}>{kpis.maxOverdueDays !== null ? `${kpis.maxOverdueDays} days late` : "Nothing overdue"}</span>
          </div>
        }
      >
        <span className={cn(VALUE, kpis.atRiskCents > 0 ? "text-warning-text" : "text-foreground")}>{formatMoney(kpis.atRiskCents, currency)}</span>
        <span className="text-foreground-subtle text-xs">overdue</span>
      </KpiCard>

      <KpiCard
        label="Seat entitlement velocity"
        aside={<span className={cn(CHIP, "text-primary")}>{kpis.seatsLicensed > 0 ? formatPercent(kpis.seatsUsed, kpis.seatsLicensed) : "0%"} allocated</span>}
        footer={
          <div className="flex flex-col gap-2">
            <UsageBar percent={seatPercent} label="Seats in use across licensed seats" className="bg-background h-2" />
            <div className="text-muted-foreground flex items-center justify-between font-mono text-[10px]">
              <span>In use: {kpis.seatsUsed}</span>
              <span>Pool remaining: {Math.max(0, kpis.seatsLicensed - kpis.seatsUsed)}</span>
            </div>
          </div>
        }
      >
        <span className={cn(VALUE, "text-foreground")}>{kpis.seatsUsed}</span>
        <span className="text-foreground-subtle font-mono text-base">/ {kpis.seatsLicensed}</span>
      </KpiCard>
    </div>
  );
}
