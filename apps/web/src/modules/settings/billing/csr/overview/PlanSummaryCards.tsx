"use client";

import { ArrowRight, CalendarClock, CreditCard, Mail, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import {
  BillingCaption,
  BillingCard,
  BillingPill,
  quotaTone,
  SubscriptionStatusPill,
  UsageBar,
} from "@/components/billing/billing-ui";
import { formatBillingDate, formatInteger, formatMoney, percentOf } from "@/lib/billing-format";
import { TONE_TEXT } from "@/lib/status-styles";
import type { BillingOverviewData } from "@/lib/types/billing";
import { cn } from "@/lib/utils";
import { OWNER_ONLY_HINT, useBillingActions } from "../billing-actions-context";

/** One of the four headline cards: a caption row, the value, and a footer line. */
function SummaryCard({ caption, aside, children, footer }: { caption: string; aside: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <BillingCard className="flex min-w-0 flex-col justify-between gap-4 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <BillingCaption>{caption}</BillingCaption>
          {aside}
        </div>
        <div className="mt-1">{children}</div>
      </div>
      <div className="text-muted-foreground font-mono text-[10px] leading-3 tracking-[0.04em]">{footer}</div>
    </BillingCard>
  );
}

const FOOTER_LINK = "text-primary hover:text-primary-hover flex shrink-0 items-center gap-0.5 disabled:pointer-events-none disabled:opacity-50";

function CurrentPlanCard({ data, onChoosePlan }: { data: BillingOverviewData; onChoosePlan: () => void }) {
  const { canManage } = useBillingActions();
  const { subscription, trial } = data;

  if (!subscription) {
    return (
      <SummaryCard
        caption="Current plan"
        aside={trial ? <BillingPill tone={trial.expired ? "danger" : "warning"} dot>{trial.expired ? "Trial ended" : "Trial"}</BillingPill> : <BillingPill tone="neutral">None</BillingPill>}
        footer={
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <CalendarClock aria-hidden className="text-foreground-subtle size-3.5" />
              {trial?.endsAt ? (
                <>
                  {trial.expired ? "Trial ended" : "Trial ends"} <span className="text-foreground tabular-nums">{formatBillingDate(trial.endsAt)}</span>
                </>
              ) : (
                "No subscription yet"
              )}
            </span>
            <button type="button" onClick={onChoosePlan} disabled={!canManage} title={canManage ? undefined : OWNER_ONLY_HINT} className={FOOTER_LINK}>
              Choose plan
              <ArrowRight aria-hidden className="size-3" />
            </button>
          </span>
        }
      >
        <p className="text-foreground text-xl font-semibold">{data.effectivePlan ? `${data.effectivePlan.name} Tier` : trial ? "Free trial" : "No plan"}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{trial && !trial.expired ? "Full access while the trial runs." : "Choose a plan to keep adding members and integrations."}</p>
      </SummaryCard>
    );
  }

  const footer =
    subscription.status === "cancelled"
      ? { label: "Ended", date: subscription.endedAt ?? subscription.currentPeriodEnd, tone: "danger" as const }
      : subscription.cancelAtPeriodEnd
        ? { label: "Ends", date: subscription.currentPeriodEnd, tone: "warning" as const }
        : subscription.status === "trialing"
          ? { label: "Billing starts", date: subscription.trialEndsAt ?? subscription.currentPeriodEnd, tone: null }
          : { label: "Auto-renews", date: subscription.renewsAt ?? subscription.currentPeriodEnd, tone: null };

  return (
    <SummaryCard
      caption="Current plan"
      aside={<SubscriptionStatusPill status={subscription.status} />}
      footer={
        <span className={cn("flex items-center gap-1.5", footer.tone && TONE_TEXT[footer.tone])}>
          <RefreshCw aria-hidden className="text-foreground-subtle size-3.5" />
          {footer.label} <span className={cn("tabular-nums", !footer.tone && "text-foreground")}>{formatBillingDate(footer.date)}</span>
        </span>
      }
    >
      <p className="text-foreground text-xl font-semibold">{subscription.planName} Tier</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="text-foreground font-mono text-base font-bold tabular-nums">{formatMoney(subscription.amountCents, subscription.currency)}</span>
        {subscription.amountCents !== null && <span className="text-foreground-subtle font-mono text-[11px]">/ month</span>}
      </p>
      {subscription.pendingPlan && (
        <p className="text-warning-text mt-1 font-mono text-[10px]">
          Moves to {subscription.pendingPlan.name} on {formatBillingDate(subscription.currentPeriodEnd)}
        </p>
      )}
    </SummaryCard>
  );
}

function SeatAllocationCard({ data, onManageSeats }: { data: BillingOverviewData; onManageSeats: () => void }) {
  const { canManage, busy } = useBillingActions();
  const { seats } = data;
  const limit = seats.licensed ?? seats.planLimit;
  const percent = percentOf(seats.used, limit);
  const tone = quotaTone(percent);
  const available = limit === null ? null : Math.max(0, limit - seats.used);
  const manageable = Boolean(data.subscription && data.subscription.status !== "cancelled");

  return (
    <SummaryCard
      caption="Seat allocation"
      aside={<span className={cn("font-mono text-[10px] font-semibold tabular-nums", TONE_TEXT[tone])}>{limit === null ? "UNLIMITED" : `${percent}% QUOTA`}</span>}
      footer={
        <span className="flex items-center justify-between gap-2">
          <span className="tabular-nums">
            {available === null ? "Unlimited seats" : `${available} available`}
            {seats.licensed !== null && seats.planLimit !== null && ` · plan max ${seats.planLimit}`}
          </span>
          <button
            type="button"
            onClick={onManageSeats}
            disabled={!manageable || !canManage || busy}
            title={!canManage ? OWNER_ONLY_HINT : manageable ? undefined : "Choose a plan to license seats."}
            className={FOOTER_LINK}
          >
            Manage
            <ArrowRight aria-hidden className="size-3" />
          </button>
        </span>
      }
    >
      <p className="text-foreground flex items-baseline gap-1 font-mono text-base font-bold tabular-nums">
        <span>{seats.used}</span>
        {limit !== null && (
          <>
            <span className="text-foreground-subtle font-normal">/</span>
            <span>{limit}</span>
          </>
        )}
        <span className="text-muted-foreground ml-1 font-sans text-xs font-normal">{seats.licensed !== null ? "Licensed seats used" : "Seats used"}</span>
      </p>
      {limit !== null && <UsageBar percent={percent} tone={tone} className="mt-2.5" label="Seats used" />}
    </SummaryCard>
  );
}

function ThroughputCard({ data }: { data: BillingOverviewData }) {
  const { events } = data;
  return (
    <SummaryCard
      caption="Event throughput"
      aside={<span className="text-primary font-mono text-[10px] font-semibold">UNMETERED</span>}
      footer={
        <span className="flex items-center justify-between gap-2">
          <span className="tabular-nums">~{formatInteger(events.dailyAverage)}/day observed</span>
          <span className="text-foreground-subtle">Not billed</span>
        </span>
      }
    >
      <p className="text-foreground flex items-baseline gap-1 font-mono text-base font-bold tabular-nums">
        <span>{formatInteger(events.used)}</span>
        <span className="text-muted-foreground ml-1 font-sans text-xs font-normal">events this period</span>
      </p>
      <UsageBar percent={events.used > 0 ? 100 : 0} tone="primary" className="mt-2.5 opacity-40" label="Events ingested this period (unmetered)" />
    </SummaryCard>
  );
}

function DefaultSourceCard({ data }: { data: BillingOverviewData }) {
  const method = data.paymentMethod;
  return (
    <SummaryCard
      caption="Default source"
      aside={method ? <BillingPill tone="success">Valid</BillingPill> : <BillingPill tone="neutral">{data.providerAvailable ? "None" : "Direct invoice"}</BillingPill>}
      footer={
        <span className="flex min-w-0 items-center gap-1">
          <Mail aria-hidden className="text-foreground-subtle size-3.5 shrink-0" />
          <span className="truncate">{data.profile.billingEmail ?? "No billing email set"}</span>
        </span>
      }
    >
      {method ? (
        <p className="text-foreground font-mono text-sm font-semibold tabular-nums">
          {method.brand} •••• {method.last4}
        </p>
      ) : (
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="bg-surface-raised border-border flex h-7 w-11 shrink-0 items-center justify-center rounded border">
            <CreditCard className="text-foreground-subtle size-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-foreground text-sm font-medium">No payment method</span>
            <span className="text-foreground-subtle font-mono text-[10px]">{data.providerAvailable ? "Add one before renewal" : "Invoices are settled directly"}</span>
          </div>
        </div>
      )}
    </SummaryCard>
  );
}

/** The four headline cards: current plan, seats, event throughput, default payment source. */
export function PlanSummaryCards({ data, onManageSeats, onChoosePlan }: { data: BillingOverviewData; onManageSeats: () => void; onChoosePlan: () => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CurrentPlanCard data={data} onChoosePlan={onChoosePlan} />
      <SeatAllocationCard data={data} onManageSeats={onManageSeats} />
      <ThroughputCard data={data} />
      <DefaultSourceCard data={data} />
    </div>
  );
}
