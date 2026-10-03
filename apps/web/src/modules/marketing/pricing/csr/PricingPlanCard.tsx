import Link from "next/link";
import { Check } from "lucide-react";
import { BillingPill } from "@/components/billing/billing-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TONE_TEXT } from "@/lib/status-styles";
import { getUpgradeCta } from "@/lib/upgrade-cta";
import type { PricingPlan } from "@/lib/types/marketing";
import type { PricingCardState, PricingCta } from "@/lib/types/pricing";
import { cn } from "@/lib/utils";

/** The plan's one call to action, as the viewer's state allows. */
function PlanCta({ cta, highlighted }: { cta: PricingCta; highlighted: boolean }) {
  if (cta.kind === "link") {
    return (
      <Button asChild variant={highlighted ? "default" : "outline"} className="w-full">
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
        className={cn("h-auto min-h-9 w-full py-2 whitespace-normal", cta.tone && TONE_TEXT[cta.tone])}
      >
        {cta.label}
      </Button>
    );
  }
  const contact = getUpgradeCta();
  return contact.href ? (
    <Button asChild variant="outline" className="w-full">
      <a href={contact.href}>Talk to us</a>
    </Button>
  ) : (
    <Button type="button" variant="outline" disabled className="h-auto min-h-9 w-full py-2 whitespace-normal">
      Talk to us
    </Button>
  );
}

/** Contact copy for Enterprise when no support address is configured: say so, never invent one. */
function ContactHelper() {
  const contact = getUpgradeCta();
  return <>{contact.href ? "Custom terms and procurement support" : contact.label}</>;
}

export function PricingPlanCard({ plan, state }: { plan: PricingPlan; state: PricingCardState }) {
  const isContract = state.cta.kind === "contact";
  const helper = state.helper;

  return (
    <Card className={cn("relative flex h-full flex-col", plan.highlighted && "border-primary/50 shadow-elevated")}>
      {plan.highlighted && (
        <Badge variant="primary" className="absolute -top-3 left-1/2 -translate-x-1/2 border-primary/40 bg-card font-mono text-[10px] tracking-wider uppercase">
          Most popular
        </Badge>
      )}
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-medium tracking-tight">{plan.name}</h2>
          {state.pill ? (
            <BillingPill tone={state.pill.tone} dot={state.pill.tone === "success" || state.pill.tone === "danger"}>
              {state.pill.label}
            </BillingPill>
          ) : isContract ? (
            <BillingPill tone="neutral">Custom</BillingPill>
          ) : null}
        </div>

        <p className="text-sm leading-6 text-muted-foreground">{plan.description}</p>

        <div>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-4xl font-medium tracking-tight">{plan.price === "Custom" ? "Contract" : plan.price}</span>
            {plan.cadence ? <span className="text-sm text-muted-foreground">/ month</span> : <span className="text-sm text-muted-foreground">/ custom</span>}
          </div>
          <p className="text-foreground-subtle mt-1 font-mono text-[11px]">
            {plan.cadence ? "Flat rate · USD · No per-seat billing" : "Priced by contract"}
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-6">
        <ul className="flex-1 space-y-3 border-t border-border pt-5">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <PlanCta cta={state.cta} highlighted={plan.highlighted} />
          {(helper || isContract) && (
            <p className="text-foreground-subtle text-center font-mono text-[11px] leading-4">{helper ?? <ContactHelper />}</p>
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
      </CardContent>
    </Card>
  );
}
