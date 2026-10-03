import { CheckCircle2, CircleSlash, History, ShieldCheck } from "lucide-react";
import { BillingCard, BillingPill } from "@/components/billing/billing-ui";
import { daysBetween, formatBillingDate } from "@/lib/billing-format";
import type { BillingOverviewData, EntitlementValue } from "@/lib/types/billing";
import { cn } from "@/lib/utils";


const CHIP = "bg-surface-container text-foreground rounded px-1.5 py-0.5";

function EntitlementValueView({ value }: { value: EntitlementValue }) {
  if (value.kind === "tags") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {value.values.map((tag) => (
          <span key={tag} className={CHIP}>
            {tag}
          </span>
        ))}
      </span>
    );
  }
  if (value.kind === "text") {
    return <span className={cn(CHIP, "px-2 uppercase tabular-nums")}>{value.value}</span>;
  }
  if (value.limit === null) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-foreground-subtle tabular-nums">
          {value.used} {value.unit}
        </span>
        <span className={cn(CHIP, "px-2 uppercase")}>Unlimited</span>
      </span>
    );
  }
  const full = value.used >= value.limit;
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      <span className={full ? "text-warning-text font-semibold" : "text-foreground"}>
        {value.used} / {value.limit}
      </span>
      <span className="text-foreground-subtle">{value.unit}</span>
    </span>
  );
}

/** "Plan Entitlements & Guardrails": what the plan includes, measured against what this organization uses. */
export function EntitlementsPanel({ data }: { data: BillingOverviewData }) {
  const { entitlements, subscription, trial, asOf } = data;
  const live = subscription && subscription.status !== "cancelled" ? subscription : null;
  const planLabel = data.effectivePlan ? `${data.effectivePlan.name} tier` : trial ? "Trial · full access" : "No plan";

  return (
    <BillingCard aria-labelledby="entitlements-title" className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden className="text-primary size-5" />
          <h2 id="entitlements-title" className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
            Plan Entitlements &amp; Guardrails
          </h2>
        </div>
        <BillingPill tone="neutral">{planLabel}</BillingPill>
      </div>

      <ul className="flex flex-col gap-2">
        {entitlements.map((entitlement) => {
          const Icon = entitlement.included ? CheckCircle2 : CircleSlash;
          return (
            <li
              key={entitlement.id}
              className="bg-surface-raised flex flex-col justify-between gap-2 rounded p-2.5 sm:flex-row sm:items-center"
            >
              <div className="flex items-center gap-2.5">
                <Icon aria-hidden className={cn("size-4.5 shrink-0", entitlement.included ? "text-success" : "text-foreground-subtle")} />
                <div className="flex min-w-0 flex-col">
                  <span className="text-foreground font-mono text-xs font-medium">{entitlement.label}</span>
                  <span className="text-foreground-subtle text-xs">{entitlement.description}</span>
                </div>
              </div>
              <div className="text-muted-foreground self-start pl-7 font-mono text-[10px] font-semibold tracking-[0.04em] sm:self-auto sm:pl-0">
                <EntitlementValueView value={entitlement.value} />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="bg-surface-container-low text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded p-2.5 font-mono text-[10px] tracking-[0.04em]">
        {live ? (
          <>
            <span className="flex items-center gap-1.5">
              <History aria-hidden className="text-primary size-3.5" />
              Subscribed since <span className="text-foreground tabular-nums">{formatBillingDate(live.subscribedSince)}</span>
            </span>
            <span className="text-success font-semibold tabular-nums">{Math.max(0, daysBetween(live.subscribedSince, asOf))} days unbroken continuity</span>
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <History aria-hidden className="text-primary size-3.5" />
            {trial && !trial.expired ? "Every limit is lifted while the trial runs." : "Limits apply once a plan is chosen; monitoring never stops."}
          </span>
        )}
      </div>
    </BillingCard>
  );
}
