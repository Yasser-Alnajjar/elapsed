import Link from "next/link";
import { Check } from "lucide-react";
import { BillingPill } from "@/components/billing/billing-ui";
import { MONO_LABEL } from "@/components/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { TONE_TEXT } from "@/lib/status-styles";
import { getUpgradeCta } from "@/lib/upgrade-cta";
import type { PricingPlan } from "@/lib/types/marketing";
import type { PricingCardState, PricingCta } from "@/lib/types/pricing";
import { cn } from "@/lib/utils";

const OUTLINE_CTA = "h-9 w-full rounded border-border bg-transparent hover:border-border-strong hover:bg-surface-hover";

/** The plan's one call to action, as the viewer's state allows. */
function PlanCta({ cta, highlighted }: { cta: PricingCta; highlighted: boolean }) {
  if (cta.kind === "link") {
    return (
      <Button asChild variant={highlighted ? "default" : "outline"} className={cn(highlighted ? "h-9 w-full rounded font-semibold" : OUTLINE_CTA)}>
        <Link href={cta.href}>{cta.label}</Link>
      </Button>
    );
  }
  if (cta.kind === "disabled") {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        className={cn("h-auto min-h-9 w-full rounded py-2 whitespace-normal", cta.tone && TONE_TEXT[cta.tone])}
      >
        {cta.label}
      </Button>
    );
  }
  const contact = getUpgradeCta();
  return contact.href ? (
    <Button asChild variant="outline" className={OUTLINE_CTA}>
      <a href={contact.href}>Talk to us</a>
    </Button>
  ) : (
    <Button type="button" variant="outline" disabled className="h-auto min-h-9 w-full rounded py-2 whitespace-normal">
      Talk to us
    </Button>
  );
}

/** Contact copy for Enterprise when no support address is configured: say so, never invent one. */
function ContactHelper() {
  const contact = getUpgradeCta();
  return <span className={contact.href ? undefined : "text-warning"}>{contact.href ? "Custom terms and procurement support" : contact.label}</span>;
}

export function PricingPlanCard({ plan, state }: { plan: PricingPlan; state: PricingCardState }) {
  const isContract = state.cta.kind === "contact";
  const helper = state.helper;

  return (
    <div
      className={cn(
        "bg-card relative flex h-full flex-col justify-between rounded p-6 transition-all",
        plan.highlighted ? "border-primary border-2 shadow-[0_0_24px_rgb(14_165_233/0.12)]" : "hover:bg-surface-raised border border-border",
      )}
    >
      {plan.highlighted && (
        <span className={cn(MONO_LABEL, "bg-primary text-primary-foreground absolute -top-3 left-1/2 -translate-x-1/2 rounded px-2.5 py-0.5 font-bold tracking-widest shadow-soft")}>
          Recommended
        </span>
      )}

      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
          {state.pill ? (
            <BillingPill tone={state.pill.tone} dot={state.pill.tone === "success" || state.pill.tone === "danger"}>
              {state.pill.label}
            </BillingPill>
          ) : isContract ? (
            <BillingPill tone="neutral">Custom</BillingPill>
          ) : null}
        </div>

        <p className="text-muted-foreground mt-1 min-h-10 text-xs leading-5">{plan.description}</p>

        <div className="mt-4 flex items-baseline gap-1">
          <span className={cn("font-mono text-[36px] leading-[44px] font-bold tabular-nums", plan.highlighted ? "text-primary" : "text-foreground")}>
            {plan.price === "Custom" ? "Contract" : plan.price}
          </span>
          <span className="text-foreground-subtle font-mono text-sm">{plan.cadence ? "/ month" : "/ custom"}</span>
        </div>
        <span className={cn(MONO_LABEL, "text-muted-foreground mt-0.5")}>{plan.cadence ? "Flat rate · USD · No per-seat billing" : "Priced by contract"}</span>

        <div className="my-4 h-px w-full bg-border" />

        <ul className="flex flex-col gap-2 text-xs text-foreground">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-1.5">
              <Check aria-hidden className="text-primary mt-px size-4 shrink-0" />
              <span className="leading-5">{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <div className="mb-1 h-px w-full bg-border" />
        <PlanCta cta={state.cta} highlighted={plan.highlighted} />
        {(helper || isContract) && (
          <p className={cn(MONO_LABEL, "text-foreground-subtle text-center leading-4 tracking-wider")}>{helper ?? <ContactHelper />}</p>
        )}
        {state.footerLink && (
          <Link
            href={state.footerLink.href}
            className={cn("text-center font-mono text-xs hover:underline", state.footerLink.tone ? TONE_TEXT[state.footerLink.tone] : "text-primary")}
          >
            {state.footerLink.label}
          </Link>
        )}
      </div>
    </div>
  );
}
